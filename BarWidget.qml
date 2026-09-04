import QtQuick
import Quickshell.Io
import qs.Commons
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
    root.bar.run(Util.shellQuote(root.sourceDir + "/start-app.sh"))
    launchRefresh.restart()
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  Timer {
    id: healthTimer
    interval: 3000
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
    command: [root.sourceDir + "/start-app.sh", "--health"]
    onExited: function(exitCode) { root.serverReady = exitCode === 0 }
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
