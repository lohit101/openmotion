# Sound and desktop alerts

Open **Settings → Alerts** after refreshing Recast.

- Enable desktop notifications and allow the browser prompt. If this site already has permission, turn on **Desktop alerts**. Banners appear when you are in another tab or app. **Test notification** shows a sample even while the app is focused.
- Sound alerts start enabled. Interact with the page after loading it to activate browser audio, or use the Ready, Attention and Failure previews. Adjust volume or mute them in this panel.
- Choose events separately: GPU connection/setup, model downloads, image/video generation and local clip exports. These switches control sound and desktop banners; normal in-app status messages remain visible.

Click a desktop notification or an in-app alert's View action to open the relevant GPU screen, Downloads inventory or saved output. Viewing a result does not change generation inputs. Exports continue to report outcomes when you leave the clip editor.

Only observed changes generate attention cues. Opening the app does not replay old completed/failed runs or announce models merely discovered on disk. A video/image is ready only after it has a saved playable/displayable output. Model download completion is grouped per batch, and failed or cancelled remaining files are not labelled ready. Short bursts share one sound; same-origin tabs coordinate delivery when browser storage/locks permit. Separate browser profiles do not share that coordination.

Keep a Recast tab and its local server running. This is local browser notification delivery, without a remote push service; closing all tabs, quitting the browser, computer sleep, tab muting or system Focus settings can prevent or delay alerts. Browser permission and system notification settings remain under your control. Preferences are saved per browser. Alerts never change GPU lifecycle, inference or model transfers and add no GPU rental usage.

Browser behavior follows the [Notifications API](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API/Using_the_Notifications_API) and [Web Audio activation/control guidance](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices). Sound cues are generated locally with oscillators; no sound files or external service is fetched.
