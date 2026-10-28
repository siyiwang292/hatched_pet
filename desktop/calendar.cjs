const { execFile } = require("node:child_process");

const FETCH_SCRIPT = `
ObjC.import("EventKit");
ObjC.import("Foundation");

function unwrap(value) {
  try {
    return ObjC.unwrap(value) || "";
  } catch (error) {
    return "";
  }
}

const store = $.EKEventStore.alloc.init;
const status = Number(store.authorizationStatusForEntityType($.EKEntityTypeEvent));
if (status === 0) {
  const semaphore = $.dispatch_semaphore_create(0);
  try {
    store.requestFullAccessToEventsWithCompletion(function (granted, error) {
      $.dispatch_semaphore_signal(semaphore);
    });
  } catch (error) {
    store.requestAccessToEntityTypeCompletion($.EKEntityTypeEvent, function (granted, error) {
      $.dispatch_semaphore_signal(semaphore);
    });
  }
  const timeout = $.dispatch_time($.DISPATCH_TIME_NOW, 12 * 1000000000);
  $.dispatch_semaphore_wait(semaphore, timeout);
}

const now = $.NSDate.date;
const start = now.dateByAddingTimeInterval(-3 * 60 * 60);
const end = now.dateByAddingTimeInterval(24 * 60 * 60);
const calendars = store.calendarsForEntityType($.EKEntityTypeEvent);
const predicate = store.predicateForEventsWithStartDateEndDateCalendars(start, end, calendars);
const matches = store.eventsMatchingPredicate(predicate);
const events = [];

for (let i = 0; i < matches.count; i++) {
  const event = matches.objectAtIndex(i);
  if (Number(event.status) === 2) continue;
  events.push({
    id: unwrap(event.eventIdentifier) || String(i),
    title: unwrap(event.title) || "Event",
    start: Number(event.startDate.timeIntervalSince1970),
    end: Number(event.endDate.timeIntervalSince1970),
    allDay: Boolean(event.isAllDay),
  });
}

events.sort(function (a, b) { return a.start - b.start; });
JSON.stringify(events);
`;

const CALENDAR_APP_SCRIPT = `
tell application "Calendar"
  set output to ""
  set nowDate to current date
  set laterDate to nowDate + (8 * hours)
  set earlierDate to nowDate - (2 * hours)
  repeat with cal in calendars
    try
      set evs to (every event of cal whose start date ≤ laterDate and end date ≥ earlierDate)
      repeat with ev in evs
        set eventTitle to summary of ev
        set startIso to ((start date of ev) as «class isot» as string)
        set endIso to ((end date of ev) as «class isot» as string)
        set allDayFlag to allday event of ev
        set output to output & eventTitle & character id 31 & startIso & character id 31 & endIso & character id 31 & allDayFlag & linefeed
      end repeat
    end try
  end repeat
  return output
end tell
`;

let eventCache = { events: [], fetchedAt: 0 };
let inflightFetch = null;

function runOsa(args, timeout) {
  return new Promise((resolve) => {
    execFile("osascript", args, { timeout }, (error, stdout) => {
      resolve(error ? "" : String(stdout));
    });
  });
}

function parseEventKit(stdout) {
  try {
    const parsed = JSON.parse(stdout.trim() || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseCalendarApp(stdout) {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const [title, startIso, endIso, allDay] = line.split("\u001f");
      const start = Date.parse(startIso);
      const end = Date.parse(endIso);
      if (!title || Number.isNaN(start) || Number.isNaN(end)) return [];
      return [
        {
          id: `${title}:${start}`,
          title,
          start: start / 1000,
          end: end / 1000,
          allDay: allDay === "true",
        },
      ];
    });
}

async function fetchCalendarEvents() {
  if (process.platform !== "darwin") {
    return [];
  }

  const now = Date.now();
  if (eventCache.events.length && now - eventCache.fetchedAt < 45_000) {
    return eventCache.events;
  }
  if (inflightFetch) return inflightFetch;

  inflightFetch = (async () => {
    try {
      const eventKit = parseEventKit(await runOsa(["-l", "JavaScript", "-e", FETCH_SCRIPT], 20_000));
      if (eventKit.length) {
        eventCache = { events: eventKit, fetchedAt: Date.now() };
        return eventKit;
      }
      if (eventCache.events.length && Date.now() - eventCache.fetchedAt < 3 * 60_000) {
        return eventCache.events;
      }

      const fromApp = parseCalendarApp(await runOsa(["-e", CALENDAR_APP_SCRIPT], 90_000));
      eventCache = { events: fromApp, fetchedAt: Date.now() };
      return fromApp;
    } finally {
      inflightFetch = null;
    }
  })();

  return inflightFetch;
}

function dayKey(date = new Date()) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function reminderForEvent(event, now = Date.now()) {
  const startMs = event.start * 1000;
  const endMs = event.end * 1000;
  const minutesUntil = Math.round((startMs - now) / 60_000);

  if (event.allDay) {
    if (now >= startMs && now < endMs) {
      return { phase: "today", minutes: 0 };
    }
    return null;
  }

  if (now >= startMs && now < endMs) {
    return { phase: "now", minutes: 0 };
  }

  if (minutesUntil >= 0 && minutesUntil <= 5) {
    return { phase: "soon", minutes: Math.max(1, minutesUntil) };
  }

  return null;
}

module.exports = {
  dayKey,
  fetchCalendarEvents,
  reminderForEvent,
};
