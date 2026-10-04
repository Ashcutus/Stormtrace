(() => {
  "use strict";

  function locationErrorMessage(error) {
    if (error?.code === "coarse") return "Only an approximate location is available. Review it below or enter your coordinates. Ethernet is supported.";
    if (error?.code === 1) return "Location permission was declined. Check your system privacy settings.";
    if (error?.code === 2) return "The system location service is unavailable. On Omarchy, install or check GeoClue.";
    if (error?.code === 3) return "Location lookup timed out. Check your connection and try again.";
    return "Your position could not be determined. Try again in a moment.";
  }

  // Validate data separately from precision: wired desktops may only have GeoIP.
  function validLocation(coords) {
    return coords && Number.isFinite(coords.latitude) && Math.abs(coords.latitude) <= 90
      && Number.isFinite(coords.longitude) && Math.abs(coords.longitude) <= 180
      && Number.isFinite(coords.accuracy) && coords.accuracy >= 0;
  }

  function locate(geolocation) {
    return new Promise((resolve, reject) => {
      let watchId;
      let finished = false;
      let coarse = null;
      let lastError = null;
      const timer = setTimeout(() => finish(null, coarse ? { code: "coarse", position: coarse } : lastError || { code: 3 }), 30000);
      function finish(position, error) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (watchId !== undefined) geolocation.clearWatch(watchId);
        if (error) reject(error);
        else resolve(position);
      }
      try {
        watchId = geolocation.watchPosition((position) => {
          if (!validLocation(position?.coords)) return;
          if (position.coords.accuracy <= 5000) finish(position);
          else if (!coarse || position.coords.accuracy < coarse.coords.accuracy) coarse = position;
        }, (error) => {
          // Transient provider errors must not end a watch that can improve.
          if (error?.code === 1) finish(null, error);
          else if (error?.code === 3) finish(null, coarse ? { code: "coarse", position: coarse } : error);
          else lastError = error;
        }, {
          enableHighAccuracy: false, maximumAge: 0, timeout: 30000,
        });
        if (finished) geolocation.clearWatch(watchId);
      } catch (error) {
        finish(null, error);
      }
    });
  }

  globalThis.StormtraceLocation = { locationErrorMessage, validLocation, locate };
})();
