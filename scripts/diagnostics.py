#!/usr/bin/env python3
"""Bounded Linux soak recorder; standard library only. No command lines/payloads saved."""
import argparse
import datetime
import json
import os
from pathlib import Path
import time
from urllib.request import urlopen

BASE = Path(os.environ.get('XDG_STATE_HOME', str(Path.home() / '.local/state'))) / 'stormtrace/diagnostics'

def request(path):
    with urlopen('http://127.0.0.1:4177/api/' + path, timeout=3) as response:
        return json.load(response)

def resource(pid):
    # stat fields after comm; CPU ticks and current resident pages, not peak ru_maxrss.
    fields = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
    return {'pid': pid, 'identity': fields[19], 'rssBytes': int(fields[21]) * os.sysconf('SC_PAGE_SIZE'),
            'cpuSeconds': (int(fields[11]) + int(fields[12])) / os.sysconf('SC_CLK_TCK')}

def descendants(pid):
    result, pending = [], [pid]
    while pending and len(result) < 128:
        current = pending.pop()
        if current in result: continue
        result.append(current)
        try:
            for task in Path(f'/proc/{current}/task').iterdir():
                pending.extend(map(int, (task / 'children').read_text().split()))
        except OSError: pass
    return result

class Session:
    def __init__(self, base=BASE, limit=2 * 1024 * 1024):
        base.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = base / datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
        self.path.mkdir(mode=0o700)
        for old in sorted(base.glob('20*'))[:-5]:
            if old.is_dir():
                for file in old.iterdir():
                    if file.name in {'summary.json', 'metrics.jsonl', 'metrics.1.jsonl', 'metrics.2.jsonl'}: file.unlink()
                try: old.rmdir()
                except OSError: pass
        self.limit = limit
        self.summary = {'schema': 1, 'startedAt': time.time(), 'samples': 0, 'pollFailures': 0, 'staleIncidents': 0}
        self.stale = False
        self.previous_browser = {}

    def write(self, record):
        file = self.path / 'metrics.jsonl'
        if file.exists() and file.stat().st_size >= self.limit:
            (self.path / 'metrics.2.jsonl').unlink(missing_ok=True)
            for src, dst in [('metrics.1.jsonl', 'metrics.2.jsonl'), ('metrics.jsonl', 'metrics.1.jsonl')]:
                if (self.path / src).exists(): (self.path / src).rename(self.path / dst)
        with file.open('a') as output:
            os.chmod(file, 0o600)
            output.write(json.dumps(record, separators=(',', ':')) + '\n')
        self.summary['samples'] += 1
        self.summary['durationSeconds'] = time.time() - self.summary['startedAt']
        rss, cpu = record.get('rssBytes'), record.get('cpuPercent')
        if rss is not None:
            self.summary.setdefault('startingRssBytes', rss)
            self.summary['finalRssBytes'] = rss
            self.summary['peakRssBytes'] = max(rss, self.summary.get('peakRssBytes', 0))
        if cpu is not None:
            self.summary['peakCpuPercent'] = max(cpu, self.summary.get('peakCpuPercent', 0))
            self.summary['cpuSamples'] = self.summary.get('cpuSamples', 0) + 1
            self.summary['cpuSum'] = self.summary.get('cpuSum', 0) + cpu
            self.summary['averageCpuPercent'] = self.summary['cpuSum'] / self.summary['cpuSamples']
        browser = record.get('browser')
        if browser:
            self.summary['latestBrowser'] = browser
            totals = self.summary.setdefault('totals', {})
            reset = browser.get('uptimeMs', 0) < self.previous_browser.get('uptimeMs', 0)
            for key in ('received', 'processed', 'connections', 'reconnects', 'networkFailures', 'errors', 'radarAttempts', 'radarSuccesses', 'radarFailures'):
                value = browser.get(key, 0)
                previous = 0 if reset else self.previous_browser.get(key, 0)
                totals[key] = totals.get(key, 0) + max(0, value - previous)
            self.previous_browser = browser
        stale = record.get('browserReportAgeMs', 0) > 30000
        if stale and not self.stale: self.summary['staleIncidents'] += 1
        self.stale = stale
        temporary = self.path / '.summary.tmp'
        temporary.write_text(json.dumps(self.summary, indent=2) + '\n')
        os.chmod(temporary, 0o600)
        temporary.replace(self.path / 'summary.json')

def record(args):
    health = request('health')
    if not request('diagnostics')['enabled']: raise SystemExit('Restart server with STORMTRACE_DIAGNOSTICS=1 first.')
    session = Session()
    print(session.path, flush=True)
    previous, last = {}, time.monotonic()
    try:
        while True:
            started = time.monotonic()
            entry = {'schema': 1, 'timestamp': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'serverPid': health['pid']}
            processes = []
            for pid in set(descendants(health['pid']) + (descendants(args.pid) if args.pid else [])):
                try: processes.append(resource(pid))
                except (OSError, ValueError, IndexError): pass
            current = {(p['pid'], p['identity']): p['cpuSeconds'] for p in processes}
            if previous:
                entry['cpuPercent'] = 100 * sum(max(0, value - previous.get(key, value)) for key, value in current.items()) / max(.001, started - last)
            entry['rssBytes'] = sum(p['rssBytes'] for p in processes)
            entry['processes'] = processes
            previous, last = current, started
            try:
                diagnostic = request('diagnostics')
                entry['browser'] = diagnostic['sample']
                if diagnostic['sample']: entry['browserReportAgeMs'] = max(0, time.time() * 1000 - diagnostic['sample']['receivedAt'])
                else: entry['browserMissing'] = True
            except Exception:
                entry['pollFailed'] = True
                session.summary['pollFailures'] += 1
            entry['collectorDurationMs'] = (time.monotonic() - started) * 1000
            session.write(entry)
            time.sleep(max(0, 10 - (time.monotonic() - started)))
    except KeyboardInterrupt:
        session.summary['endedAt'] = time.time()
        session.write({'timestamp': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'event': 'collector_stop'})

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['record', 'latest', 'analyse', 'clean'])
    parser.add_argument('--pid', type=int, help='Optional native GTK root PID; includes WebKit descendants')
    args = parser.parse_args()
    if args.action == 'record': record(args)
    elif args.action == 'clean':
        import shutil
        if BASE.exists(): shutil.rmtree(BASE)
    else:
        sessions = sorted(BASE.glob('20*'))
        if not sessions: raise SystemExit('No diagnostics sessions')
        latest = sessions[-1]
        print(latest)
        if args.action == 'analyse':
            summary = json.loads((latest / 'summary.json').read_text())
            print(json.dumps(summary, indent=2))
            print('Inspect chronological metrics.2.jsonl, metrics.1.jsonl, metrics.jsonl; correlate counter deltas, RSS, CPU, lag and freshness. Missing samples are unknown, not zero. See docs/diagnostics.md.')
