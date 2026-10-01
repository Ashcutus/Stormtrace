(() => {
  "use strict";

  function locationErrorMessage(error) {
    if (error?.code === 1) return "Location permission was declined. Check your system privacy settings.";
    if (error?.code === 2) return "The system location service is unavailable. On Omarchy, install or check GeoClue.";
    if (error?.code === 3) return "Location lookup timed out. Check your connection and try again.";
    return "Your position could not be determined. Try again in a moment.";
  }

  globalThis.StormtraceLocation = { locationErrorMessage };
})();
