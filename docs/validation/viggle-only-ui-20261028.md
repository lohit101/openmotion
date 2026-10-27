# Temporarily disable the legacy video UI

2026-10-28. The motion panel no longer shows Character swap / Motion transfer tabs. Its video selector keeps Viggle available and shows SCAIL-2 / Wan as disabled. The selection handler also rejects new legacy selections.

A restored legacy draft is not silently converted: new Generate is disabled, and a visible footer action opens the model selector so the user can explicitly choose Viggle. The existing Viggle selection handler still applies its compatible swap/native-fps settings. No model, graph, dependency, runtime or saved run was removed. Existing paid run viewing, cancellation and recovery paths are unchanged, as are backend/API capabilities.

TypeScript/production build and `git diff --check` pass. Source review confirms there is no Generation mode tab group in the motion panel and that new-generation validity requires Viggle. This is a frontend restriction, not a server-side retirement or an inference evaluation. No GPU operation was performed.
