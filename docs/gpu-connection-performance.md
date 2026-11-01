# GPU connection responsiveness

The November 2 investigation caught the production Node server at 102.6% CPU and a 2 GB physical footprint. A basic local status request timed out after three seconds. A macOS CPU sample placed the blocked main thread in a stream callback, repeatedly constructing JSON objects.

Every provisioning log line synchronously persisted and broadcast the whole cloud snapshot. Every cloud broadcast then replayed confirmed-stop reconciliation across 53 historical rentals. Clarity's reconciliation decoded the entire Library for each rental, including completed paid jobs. Installation output arriving faster than those checks could complete blocked status requests and UI updates. Browser event streams also ignored write backpressure, allowing obsolete progress snapshots to accumulate for a slow or sleeping tab.

The fixes are:

- Setup log changes are collected immediately in the existing bounded log and broadcast at most every 250 ms. Lifecycle transitions, errors and completion still flush immediately. Carriage-return progress lines are recognized and unfinished log fragments are bounded.
- A partial SQLite index identifies unfinished and unresolved jobs. Reconciliation and frequently polled GPU safety guards decode only those jobs, preserving unknown remote face/Clarity activity and timestamp/instance checks. Existing job JSON and paid recipes are unchanged.
- Browser event streams honor backpressure. They keep the newest pending update per item, retain different jobs separately, and reconnect to a full snapshot if too many distinct items accumulate. Closing a tab releases its listeners and pending updates.

A local copy containing 342 jobs and 53 confirmed historical stops reproduced approximately 425 ms of main-thread work per cloud event. The changed reconciliation averaged 0.30 ms for the same history. This isolates the repeated history scan; it is not a GPU boot-time benchmark. The remote engine, network and host can still determine how long setup itself takes.

Regression checks cover a 5,000-line setup burst, 20,000 blocked-client updates, terminal states, repeated drain/backpressure, bounded pending items, the SQLite query plan, live changes to job activity, and existing unresolved-work protections. See the [sanitized validation receipt](validation/gpu-connection-performance-20261102.json) for final test and deployment status. Private CPU samples, database copies and the benchmark remain in ignored local storage.

All 533 Studio tests, typecheck and the production build passed. Deployment waited for the user's model/runtime installation to finish, then preserved all 342 existing job records and both drafts during a guarded restart. The existing engine was reconnected without resuming compute or downloading anything. Five live status requests averaged 31.6 ms; the live event stream delivered its bootstrap and the latest provider snapshot. Node reported 1.2% CPU/197,072 KB RSS 37 seconds after startup. These live readings are after setup, rather than a second paid startup benchmark. Subsequent user work remains untouched.
