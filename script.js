// --- DOM Elements ---
const startButton = document.getElementById('startCompass');
const compassNeedle = document.getElementById('compassNeedle');
const distanceText = document.getElementById('distanceText');
const statusText = document.getElementById('statusText');
const hoursText = document.getElementById('hoursText');

// --- Configuration ---
const standardSystemet = { 
    0: null,     // sun
    1: [10, 19], // mon 
    2: [10, 19], 
    3: [10, 19], 
    4: [10, 19], 
    5: [10, 19], 
    6: [10, 15] };
const extendedSystemet = { 
    0: null,     // sun
    1: [10, 20], // mon
    2: [10, 20], 
    3: [10, 20], 
    4: [10, 20], 
    5: [10, 20], 
    6: [10, 15] };

const beerShops = [
    {
        name: "Carmen",
        lat: 59.3150722,
        lon: 18.0710663,
        hours: { 0: [16, 01], 1: [16, 01], 2: [16, 01], 3: [16, 01], 4: [16, 01], 5: [16, 01], 6: [16, 01] }
    }
];


// --- State Variables ---
let currentPosition = null;
let currentHeading = null;
let nearestShop = null;
let watchId = null; // To store the watchPosition ID
let hoursIntervalId = null; // To store the interval timer ID

// --- Helper Functions ---

// Calculate distance between two coordinates in kilometers
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the earth in km
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const d = R * c; // Distance in km
    return d;
}

function deg2rad(deg) {
    return deg * (Math.PI / 180);
}

// Calculate initial bearing between two coordinates in degrees
function getBearingFromLatLon(lat1, lon1, lat2, lon2) {
    const φ1 = deg2rad(lat1);
    const φ2 = deg2rad(lat2);
    const λ1 = deg2rad(lon1);
    const λ2 = deg2rad(lon2);
    const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) -
              Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
    let brng = Math.atan2(y, x);
    brng = rad2deg(brng);
    return (brng + 360) % 360; // Normalize to 0-360 degrees
}

 function rad2deg(rad) {
    return rad * (180 / Math.PI);
 }

// --- Core Logic Functions ---

/**
 * Finds the target shop based on priority:
 * 1. Nearest shop that is currently open.
 * 2. If none open, the nearest shop among those that will open soonest.
 * @returns {object|null} The target shop object (with distance and statusInfo) or null if none found.
 */
function findTargetShop() {
    if (!currentPosition) return null; // Need user's location first

    const now = new Date();
    let openShops = [];
    let closedShopsInfo = []; // To store info about closed shops for fallback

    // Step 1: Iterate, calculate distance, and get status for all shops
    beerShops.forEach(shop => {
        // Basic check if shop has essential data
        if (shop.lat === undefined || shop.lon === undefined || !shop.hours) {
            console.warn(`Shop missing coordinates or hours: ${shop.name}`);
            return; // Skip this shop
        }

        const distance = getDistanceFromLatLonInKm(
            currentPosition.coords.latitude,
            currentPosition.coords.longitude,
            shop.lat,
            shop.lon
        );

        const statusInfo = getShopStatus(now, shop.hours);

        // Store calculated info temporarily (doesn't modify original beerShops array)
        const shopWithInfo = { ...shop, distance: distance, statusInfo: statusInfo };

        if (statusInfo && statusInfo.status === 'open') {
            openShops.push(shopWithInfo);
        } else if (statusInfo && statusInfo.status === 'closed' && statusInfo.eventType === 'opens') {
             // Only consider closed shops that will open eventually
             closedShopsInfo.push(shopWithInfo);
        }
        // Ignore shops with status errors or that never open
    });

    // Step 2: Prioritize nearest open shop
    if (openShops.length > 0) {
        console.log("Found open shops:", openShops.length);
        openShops.sort((a, b) => a.distance - b.distance); // Sort open shops by distance
        return openShops[0]; // Return the nearest open one
    }

    // Step 3: If no open shops, find the nearest that opens soonest
    if (closedShopsInfo.length > 0) {
        console.log("No open shops. Checking closed shops:", closedShopsInfo.length);
        // Find the minimum next opening time
        let soonestOpenTime = Infinity;
        closedShopsInfo.forEach(shop => {
            if (shop.statusInfo.nextEventTime.getTime() < soonestOpenTime) {
                soonestOpenTime = shop.statusInfo.nextEventTime.getTime();
            }
        });

         // Filter for shops opening at that soonest time
         const shopsOpeningSoonest = closedShopsInfo.filter(shop =>
            shop.statusInfo.nextEventTime.getTime() === soonestOpenTime
         );

         if (shopsOpeningSoonest.length > 0) {
             // Among those opening soonest, find the nearest one
             shopsOpeningSoonest.sort((a, b) => a.distance - b.distance);
             console.log("Targeting nearest shop opening soonest:", shopsOpeningSoonest[0].name);
             return shopsOpeningSoonest[0];
         }
    }

    // Step 4: Fallback - no open shops found, and no closed shops found opening soon
    console.log("Could not find any open or soon-to-open shops.");
    return null; // Or return geographically nearest as absolute fallback? Null is clearer.
}

/**
 * Determines if the shop is open/closed and when the next event (open/close) occurs.
 * Handles opening hours crossing midnight.
 * @param {Date} now The current date and time.
 * @param {object} shopHours The opening hours object for the specific shop.
 * @returns {object|null} Object with status, eventType, nextEventTime, or null on error.
 */
function getShopStatus(now, shopHours) {
    // Add safety check for missing hours data
    if (!shopHours) {
        console.error("Shop hours data is missing or invalid for status check.");
        return null;
    }

    const currentDay = now.getDay(); // 0=Sun, 6=Sat
    const currentHour = now.getHours();
    const currentMinutes = now.getMinutes();
    const currentTimeInMinutes = currentHour * 60 + currentMinutes;

    let status = 'closed';
    let eventType = 'opens';
    let nextEventTime = null;

    // --- Check yesterday's hours first for overnight opening ---
    const yesterdayDay = (currentDay + 6) % 7; // Day before today
    const yesterdayHours = shopHours[yesterdayDay];
    if (yesterdayHours && Array.isArray(yesterdayHours) && yesterdayHours.length === 2) {
        const yOpen = yesterdayHours[0];
        const yClose = yesterdayHours[1];
        // Check if yesterday's hours crossed midnight (close hour < open hour)
        if (yClose < yOpen) {
            const yCloseTimeInMinutes = yClose * 60;
            // Are we currently *before* yesterday's closing time (which occurs today)?
            if (currentTimeInMinutes < yCloseTimeInMinutes) {
                // Currently open from yesterday!
                status = 'open';
                eventType = 'closes';
                nextEventTime = new Date(now);
                nextEventTime.setHours(yClose, 0, 0, 0); // Closing time is today at yClose hour
                // We've determined the status, no need to check today's opening further for this case
            }
        }
    }

    // --- If not open from yesterday, check today's schedule ---
    if (status === 'closed') { // Only proceed if not already marked open from yesterday
        const todayHours = shopHours[currentDay];
        if (todayHours && Array.isArray(todayHours) && todayHours.length === 2) {
            const openTime = todayHours[0];
            const closeTime = todayHours[1];
            const openTimeInMinutes = openTime * 60;
            const closeTimeInMinutes = closeTime * 60;

            if (closeTime > openTime) { // Normal case: closes same day
                if (currentTimeInMinutes >= openTimeInMinutes && currentTimeInMinutes < closeTimeInMinutes) {
                    // Currently Open, closes later today
                    status = 'open';
                    eventType = 'closes';
                    nextEventTime = new Date(now);
                    nextEventTime.setHours(closeTime, 0, 0, 0);
                } else if (currentTimeInMinutes < openTimeInMinutes) {
                    // Closed, opens later today
                    status = 'closed';
                    eventType = 'opens';
                    nextEventTime = new Date(now);
                    nextEventTime.setHours(openTime, 0, 0, 0);
                }
                // else: closed past closing time today, will be handled by 'find next opening' logic below

            } else { // Special case: closes after midnight (closeTime < openTime)
                if (currentTimeInMinutes >= openTimeInMinutes) {
                    // Currently Open, closes tomorrow morning
                    status = 'open';
                    eventType = 'closes';
                    nextEventTime = new Date(now);
                    // Set date to tomorrow
                    nextEventTime.setDate(now.getDate() + 1);
                    nextEventTime.setHours(closeTime, 0, 0, 0);
                } else {
                    // Currently closed, before opening time today (but will close tomorrow)
                    status = 'closed';
                    eventType = 'opens';
                    nextEventTime = new Date(now);
                    nextEventTime.setHours(openTime, 0, 0, 0); // Opens later today
                }
            }
        }
        // else: Closed all day today based on todayHours being null or invalid, handled below
    }


    // --- If status is still 'closed' and nextEventTime wasn't set above, find the next opening day/time ---
    if (status === 'closed' && !nextEventTime) {
         let nextDay = currentDay;
         let daysToAdd = 0;
         let attempts = 0; // Safety break
         let nextOpeningHours = null;

         // Start search from tomorrow if we determined we are past closing time today
         const todayHoursCheck = shopHours[currentDay];
         if (todayHoursCheck && Array.isArray(todayHoursCheck) && todayHoursCheck.length === 2 &&
             todayHoursCheck[1] > todayHoursCheck[0] && // Normal closing today
             currentTimeInMinutes >= (todayHoursCheck[1] * 60)) { // And we are past it
                 daysToAdd = 1;
                 nextDay = (currentDay + 1) % 7;
         }
         // Also start search from tomorrow if today is null/invalid and it's the first attempt
         else if (!todayHoursCheck || !Array.isArray(todayHoursCheck) || todayHoursCheck.length !== 2) {
            // No valid hours today, start search from tomorrow
            daysToAdd = 1;
            nextDay = (currentDay + 1) % 7;
         }
         // Otherwise, the loop starts by checking the *next* day relative to the last checked 'nextDay'

         do {
             // If not the first iteration where we might have forced daysToAdd=1, increment day
              if (attempts > 0 || daysToAdd == 0) { // Ensure we advance day after checking 'currentDay' implicitly if needed
                    daysToAdd++;
                    nextDay = (nextDay + 1) % 7;
              }

             nextOpeningHours = shopHours[nextDay];
             attempts++;
              // Ensure we break if we loop all the way around without forcing start from tomorrow
             if (attempts > 7) {
                 console.error("Looped through all days without finding opening hours.");
                 break;
             }
         } while ((!nextOpeningHours || !Array.isArray(nextOpeningHours) || nextOpeningHours.length !== 2) && attempts < 8); // Find next day with VALID hours


         if (attempts < 8 && nextOpeningHours) {
             const nextOpeningHour = nextOpeningHours[0];
             nextEventTime = new Date(now);
             nextEventTime.setDate(now.getDate() + daysToAdd); // Set to the correct future date
             nextEventTime.setHours(nextOpeningHour, 0, 0, 0); // Set to opening time
         } else {
             // Only log error if we didn't find anything after checking 7+ days
              if (attempts >= 7) console.error("Could not find next valid opening day within 7 days.");
             return null;
         }
    }

    // Final checks and return
    if (!nextEventTime) {
        console.error("Logical error: Could not determine next event time at the end.");
        return null;
    }

    return {
        status: status,
        eventType: eventType,
        nextEventTime: nextEventTime
    };
}

/**
 * Formats a time difference in milliseconds into a human-readable string.
 * @param {number} diffMs Time difference in milliseconds.
 * @returns {string} Formatted string e.g., "1 hour 53 minutes".
 */
function formatTimeDifference(diffMs) {
    if (diffMs < 0) diffMs = 0;

    const totalSeconds = Math.floor(diffMs / 1000);
    const totalMinutes = Math.floor(totalSeconds / 60);
    const totalHours = Math.floor(totalMinutes / 60);
    const days = Math.floor(totalHours / 24);

    const minutes = totalMinutes % 60;
    const hours = totalHours % 24;

    let parts = [];
    if (days > 0) parts.push(`${days} day${days > 1 ? 's' : ''}`);
    if (hours > 0) parts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
    // Refined logic for minutes display
    if (minutes > 0 || (days === 0 && hours === 0)) {
         // Show minutes if > 0 OR if it's the only unit (e.g., less than 1 hour left)
         parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
    }

    if (parts.length === 0 && diffMs < 1000) { // If difference is negligible, consider it "Now"
        return "Now";
    }
    if (parts.length === 0) {
        // This might happen if diffMs is very small but not zero, e.g., few seconds
        return "Less than a minute"; // Or "Calculating..."
    }

    return parts.join(' ');
}


// Updates the opening hours display text
function updateOpeningHoursDisplay(shopToDisplay) { // Accept target shop as argument
    const now = new Date();

    // Use the passed shopToDisplay, check if it and its hours exist
    if (shopToDisplay && shopToDisplay.hours) {
        // Use the statusInfo already calculated in findTargetShop if available,
        // otherwise recalculate (recalculation is safer if time passed)
        const statusInfo = shopToDisplay.statusInfo || getShopStatus(now, shopToDisplay.hours);

        if (statusInfo) {
            const diffMs = statusInfo.nextEventTime.getTime() - now.getTime();
            const formattedDiff = formatTimeDifference(diffMs);
            const prefix = statusInfo.status === 'open' ? 'Closes' : 'Opens';
            // Include shop name in the hours text for clarity
            hoursText.textContent = `${shopToDisplay.name} ${prefix.toLowerCase()} in: ${formattedDiff}`;
        } else {
            hoursText.textContent = `Opening hours for ${shopToDisplay.name}: Status unavailable`;
        }
    } else if (shopToDisplay) {
         hoursText.textContent = `Opening hours for ${shopToDisplay.name}: Data unavailable`;
    }
     // else: No target shop determined, message handled in updateDisplay
}

let targetShop = null;

// Main function to update all UI elements
function updateDisplay() {
    targetShop = findTargetShop(); // Find the appropriate target shop

    statusText.textContent = " ";
    hoursText.textContent = " ";
    distanceText.textContent = "Distance: --- km";

    if (targetShop) {
        // Update distance text
        distanceText.textContent = `Distance: ${targetShop.distance.toFixed(2)} km (${targetShop.name})`;

        // Calculate bearing if we have position
        const bearing = getBearingFromLatLon(
            currentPosition.coords.latitude,
            currentPosition.coords.longitude,
            targetShop.lat,
            targetShop.lon
        );

        // Rotate needle if we have heading and bearing
        if (currentHeading !== null) {
             if (typeof currentHeading === 'number') {
                 const rotation = bearing - currentHeading;
                 compassNeedle.style.transform = `rotate(${rotation}deg)`;
                 statusText.textContent = `Heading: ${Math.round(currentHeading)}° | Bearing: ${Math.round(bearing)}°`;
             } else {
                 statusText.textContent = "Invalid heading data";
                 console.warn("currentHeading is not a number:", currentHeading);
             }
        } else {
              statusText.textContent = "Waiting for compass...";
              // Optional: Point needle towards target if no compass data? Requires bearing only.
              // compassNeedle.style.transform = `rotate(${bearing}deg)`; // This points North towards target
        }
        // Update opening hours display using the found targetShop
        updateOpeningHoursDisplay(targetShop); // Pass targetShop to the hours display function
    } else {
          distanceText.textContent = `Distance: --- km`;
          hoursText.textContent = "No open or soon-opening shops found.";
          compassNeedle.style.transform = `rotate(0deg)`;
          if (!currentPosition) {
             statusText.textContent = "Waiting for GPS signal...";
          } else {
             statusText.textContent = "No target found.";
          }
    }
}

// --- Event Handlers ---

function handleLocationUpdate(pos) {
    console.log("Location update:", pos.coords);
    currentPosition = pos;
    updateDisplay(); // Update UI whenever location changes
}

function handleLocationError(err) {
    console.error("Location Error:", err.message, `(Code: ${err.code})`);
    statusText.textContent = `Error getting location: ${err.message}`;
    if (err.code === 1) { // PERMISSION_DENIED
        statusText.textContent = "Location permission denied. Please enable in settings.";
        stopTracking();
    } else if (err.code === 2) { // POSITION_UNAVAILABLE
        statusText.textContent = "Location unavailable. Check signal/settings.";
        // Don't necessarily stop tracking, might become available again
    } else if (err.code === 3) { // TIMEOUT
        statusText.textContent = "Location request timed out.";
    }
}

function handleOrientationUpdate(event) {
    let heading = null;
     // Prefer absolute orientation if available
    if (event.absolute === true && event.alpha !== null) {
        heading = event.alpha;
    } else if (event.webkitCompassHeading !== undefined) {
        heading = event.webkitCompassHeading; // Fallback for older iOS
    } else if (event.alpha !== null) {
        // Use alpha, but be aware it might be relative, not true north
        // depending on the device and browser implementation.
        heading = event.alpha;
        // console.log("Using relative alpha for heading."); // Optional log
    }


    if (typeof heading === 'number') {
          currentHeading = heading;
          // console.log("Heading update:", currentHeading); // Reduce console noise
          updateDisplay(); // Update display when heading changes
    } else if (currentHeading === null) { // Only show error if we never got a heading
        statusText.textContent = "Compass data not available or invalid.";
        console.warn("Received invalid heading data:", event);
    }
}

// Request permissions and start tracking
function requestPermissionsAndStart() {
    statusText.textContent = "Requesting permissions...";

    // Clear previous interval timer if any
    if (hoursIntervalId) {
        clearInterval(hoursIntervalId);
        hoursIntervalId = null;
    }

    // --- Promise-based Permission Flow (Cleaner) ---
    let orientationPromise = Promise.resolve(); // Assume granted if no requestPermission needed

    // 1. Try requesting Device Orientation permission if method exists (iOS 13+)
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
        orientationPromise = DeviceOrientationEvent.requestPermission()
            .then(permissionState => {
                if (permissionState === 'granted') {
                    console.log("Orientation permission granted.");
                    return true; // Indicate success
                } else {
                    console.log("Orientation permission denied.");
                    statusText.textContent = "Compass permission denied.";
                    // Don't throw error, just proceed without compass maybe
                    return false; // Indicate failure
                }
            })
            .catch(error => {
                console.error("Orientation Permission Request Error:", error);
                statusText.textContent = "Error requesting compass permission.";
                return false; // Indicate failure
            });
    }

    // After attempting orientation permission (or immediately if no request needed):
    orientationPromise.then(orientationGranted => {
        if (orientationGranted !== false) { // Proceed if granted or not applicable
            // Add listeners regardless of explicit grant for non-iOS13+ or if requestPermission doesn't exist
            window.addEventListener('deviceorientationabsolute', handleOrientationUpdate, true);
            window.addEventListener('deviceorientation', handleOrientationUpdate, true); // Fallback
            console.log("Orientation listeners added.");
        }

        // 2. Request Geolocation
        startGeolocation();

        // Call initial update *after* starting requests
        updateDisplay();

        // Start the interval timer *after* starting everything
        hoursIntervalId = setInterval(updateDisplay, 60000); // 60000ms = 1 minute

    }); // End of orientationPromise.then
}


function startGeolocation() {
     if (navigator.geolocation) {
        statusText.textContent = "Attempting to get location...";
        // Clear previous watch if any
        if (watchId !== null) {
            navigator.geolocation.clearWatch(watchId);
        }
        watchId = navigator.geolocation.watchPosition(
            handleLocationUpdate,
            handleLocationError,
            {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: 20000 // Increased timeout slightly
            }
        );
     } else {
        statusText.textContent = "Geolocation is not supported by this browser.";
        alert("Geolocation is not supported by this browser."); // More prominent alert
     }
}

// Function to stop tracking
function stopTracking() {
     if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
        console.log("Stopped location tracking.");
     }
     window.removeEventListener('deviceorientationabsolute', handleOrientationUpdate, true);
     window.removeEventListener('deviceorientation', handleOrientationUpdate, true);
     console.log("Stopped orientation tracking.");

     if (hoursIntervalId !== null) {
        clearInterval(hoursIntervalId);
        hoursIntervalId = null;
        console.log("Stopped hours update interval.");
     }
     // Reset UI elements if desired
     // statusText.textContent = "Tracking stopped.";
     // distanceText.textContent = `Distance: --- km`;
     // hoursText.textContent = "Opening hours: -";
     // currentPosition = null;
     // currentHeading = null;
     // nearestShop = null;
     // compassNeedle.style.transform = `rotate(0deg)`;
}

// --- Initial Setup ---
startButton.addEventListener('click', requestPermissionsAndStart);

// Register the service worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { // Register SW after page load
         navigator.serviceWorker.register('/sw.js')
            .then(registration => console.log('Service Worker registered with scope:', registration.scope))
            .catch(error => console.error('Service Worker registration failed:', error));
    });
}

// Optional: Add visibility change listener to potentially pause/resume expensive tracking?
// document.addEventListener("visibilitychange", () => {
//   if (document.visibilityState === "hidden") {
//     // Maybe stop watchPosition/orientation listeners? Requires restart logic on visible.
//     // stopTracking(); // Example - careful with state
//   } else {
//     // Restart tracking if needed
//     // if (trackingWasActive) requestPermissionsAndStart();
//   }
// });
