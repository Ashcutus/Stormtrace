import QtQuick
import Quickshell.Io
import qs.Ui

BarWidget {
  id: root
  moduleName: "stormtrace.lightning"

  property bool serverReady: false
  readonly property string sourceDir: {
    var url = Qt.resolvedUrl(".").toString().replace(/^file:\/\//, "").replace(/\/$/, "")
    return decodeURIComponent(url)
  }

  function launch() {
    if (!root.bar || !root.sourceDir) return
    root.bar.run(root.bar.shellQuote(root.sourceDir + "/start-app.sh"))
    launchRefresh.restart()
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  Timer {
    id: healthTimer
    interval: 10000
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: if (!healthProc.running) healthProc.running = true
  }

  Timer {
    id: launchRefresh
    interval: 1200
    repeat: false
    onTriggered: if (!healthProc.running) healthProc.running = true
  }

  Process {
    id: healthProc
    command: ["curl", "-fsS", "--max-time", "1", "http://127.0.0.1:4177/api/health"]
    onExited: function(exitCode) { root.serverReady = exitCode === 0 }
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: "ϟ"
    active: root.serverReady
    tooltipText: root.serverReady ? "Open Stormtrace · live receiver running" : "Open Stormtrace lightning map"
    onPressed: root.launch()
  }
}
