Opening FeedbackRecorder on a Mac
=================================

FeedbackRecorder is published by Rabamba AB. A copy downloaded from the
official releases page is signed with Rabamba AB's Apple Developer ID and
checked by Apple (notarized), so it opens like any other app you download.
Your recordings are processed and stored on your own Mac.


Installing it
-------------

1. Drag FeedbackRecorder onto the Applications folder in this window.

2. Open Applications and double-click FeedbackRecorder.
   The first time, macOS asks whether you are sure you want to open an
   app downloaded from the internet, and says Apple checked it for
   malicious software. Click Open.

3. The app asks for Microphone and Screen Recording. Allow both.

   To timestamp clicks and keyboard activity it also asks for
   Accessibility and Input Monitoring. These are optional: recording
   still works without them. Ordinary typed text is never stored;
   shortcuts and navigation keys are named, and other typing is only
   counted.

   These permissions only take effect after a restart, so the app
   offers you a "Restart FeedbackRecorder" button. Use it.


If macOS refuses to open it
---------------------------

This should not happen with a copy from the official releases page. It
does happen with a copy somebody built themselves, from the source code
or from a fork of the project, because only the official releases are
signed by Rabamba AB. macOS then says:

    "FeedbackRecorder" Not Opened

    Apple could not verify "FeedbackRecorder" is free of malware that
    may harm your Mac or compromise your privacy.

To open such a copy anyway:

1. The message offers two buttons, "Move to Trash" and "Done".
   Click Done. Do not click Move to Trash.

2. Open System Settings, go to Privacy & Security, and scroll down to
   Security. There is a line saying:

       "FeedbackRecorder" was blocked to protect your Mac.

   Click "Open Anyway" next to it, confirm with "Open", and authenticate
   if macOS asks.

   That line only appears after step 1, so do not skip it.

   On macOS 14 and earlier you can right-click the app and choose Open
   instead. Apple removed that shortcut in macOS 15, so on newer
   versions the Privacy & Security route above is the only one.

Faster, if you are comfortable with Terminal: after dragging the app to
Applications, open the Terminal app and run:

    xattr -dr com.apple.quarantine /Applications/FeedbackRecorder.app

Then open the app normally. No sudo, no password. That command removes
the "downloaded from the internet" marker from this one app, which is
what triggers the check. It changes nothing else on your Mac and
affects no other app.

Do not use "sudo spctl --master-disable". It turns the check off for
every app on your Mac, for good, and Apple has been removing it.


If it says the app is damaged
-----------------------------

If macOS says FeedbackRecorder "is damaged and can't be opened" and
offers to move it to the Trash, do not move it to the Trash. Something
has disturbed the app's signature, usually the download.

Download the app again from the official releases page, and check you
took the right one: Apple-silicon Macs need the arm64 file, Intel Macs
need the x64 file.

If it is a copy you or somebody else built, run the same command as
above:

    xattr -dr com.apple.quarantine /Applications/FeedbackRecorder.app


About updates
-------------

FeedbackRecorder updates itself. When a new build is available it says so,
and "Update now" downloads it, replaces this copy and reopens. You do
not have to visit the releases page again. A signed copy only installs
an update signed by the same developer.

macOS keeps Microphone, Screen Recording, Accessibility and Input
Monitoring from one signed release to the next. A copy from before
releases were signed, or one somebody built themselves, may need one
final approval after updating. In that case FeedbackRecorder removes
its own stale permission entries first, so you can allow the current
copy and use its "Restart FeedbackRecorder" button without hunting for
the old one.


Where to get help
-----------------

https://github.com/magnuslandahl/FeedbackRecorder
