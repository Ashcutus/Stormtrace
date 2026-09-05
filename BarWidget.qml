import QtQuick
import Quickshell.Io
import qs.Commons
import qs.Ui

BarWidget {
  id: root
  moduleName: "stormtrace.lightning"

  property bool serverReady: false
  property string canonicalSourceDir: ""
  property string appVersion: ""
  readonly property string sourceDir: {
    var url = Qt.resolvedUrl(".").toString().replace(/^file:\/\//, "").replace(/\/$/, "")
    return decodeURIComponent(url)
  }

  function launch() {
    if (!root.bar || !root.sourceDir) return
    root.bar.run(Util.shellQuote(root.sourceDir + "/start-app.sh"))
    launchRefresh.restart()
  }

  function refreshHealth() {
    if (!canonicalSourceDir || !appVersion) {
      serverReady = false
      return
    }
    if (!healthProc.running) healthProc.running = true
  }

  function healthMatches(output) {
    try {
      var data = JSON.parse(output)
      return Boolean(canonicalSourceDir && appVersion)
        && data.ok === true && data.app === "stormtrace"
        && data.version === appVersion
        && typeof data.root === "string"
        && data.root.replace(/\/$/, "") === canonicalSourceDir
    } catch (_) {
      return false
    }
  }

  onCanonicalSourceDirChanged: refreshHealth()
  onAppVersionChanged: refreshHealth()

  // Resolve symlinked plugin installations once, without spawning Python on polls.
  Process {
    running: true
    command: ["readlink", "-f", "--", root.sourceDir]
    stdout: StdioCollector { id: sourcePathOutput }
    onExited: function(exitCode) {
      root.canonicalSourceDir = exitCode === 0 ? sourcePathOutput.text.trim() : ""
    }
  }

  FileView {
    path: root.sourceDir + "/manifest.json"
    watchChanges: true
    onFileChanged: reload()
    onLoaded: {
      try {
        var manifest = JSON.parse(text())
        root.appVersion = typeof manifest.version === "string" ? manifest.version : ""
      } catch (_) {
        root.appVersion = ""
        root.serverReady = false
      }
    }
    onLoadFailed: { root.appVersion = ""; root.serverReady = false }
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  Timer {
    id: healthTimer
    interval: 10000
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: root.refreshHealth()
  }

  Timer {
    id: launchRefresh
    interval: 1200
    repeat: false
    onTriggered: root.refreshHealth()
  }

  Process {
    id: healthProc
    command: ["curl", "-fsS", "--max-time", "1", "http://127.0.0.1:4177/api/health"]
    stdout: StdioCollector { id: healthOutput }
    onExited: function(exitCode) { root.serverReady = exitCode === 0 && root.healthMatches(healthOutput.text) }
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: "ϟ"
    active: root.serverReady
    tooltipText: root.serverReady ? "Open Stormtrace · local service ready" : "Start Stormtrace lightning monitor"
    onPressed: root.launch()
  }
}
