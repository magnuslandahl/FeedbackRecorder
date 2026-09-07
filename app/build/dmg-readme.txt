Opening FeedbackRecorder on a Mac
=================================

macOS will refuse to open this app the first time, and say it cannot be
opened or cannot be checked for malicious software.

That is expected. It is not a sign that anything is wrong with the app.

Apple only vouches for apps signed with a paid Apple Developer
certificate, which costs 99 USD a year. FeedbackRecorder is a free,
open-source project and does not have one, so macOS treats it as an app
it has never heard of. Everything the app does runs on your own machine;
nothing is uploaded.


Installing it
-------------

1. Drag FeedbackRecorder onto the Applications folder in this window.

2. Open Applications and double-click FeedbackRecorder.
   macOS refuses. Click Done.

3. Open System Settings, go to Privacy & Security, and scroll down.
   There is a message about FeedbackRecorder being blocked, with an
   "Open Anyway" button next to it. Click it, then confirm with "Open".

   The button only appears after step 2, so do not skip it.

   On macOS 14 and earlier you can right-click the app and choose Open
   instead. Apple removed that shortcut in macOS 15, so on newer
   versions the Privacy & Security route above is the only one.

4. The app asks for Microphone and Screen Recording. Allow both.
   Screen Recording only takes effect after a restart, so the app
   offers you a "Restart FeedbackRecorder" button. Use it.


Faster, if you are comfortable with Terminal
--------------------------------------------

After dragging the app to Applications, open the Terminal app and run:

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
offers to move it to the Trash, do not move it to the Trash. The app is
not damaged. Something has disturbed the app's signature, usually the
download.

Run the same command as above:

    xattr -dr com.apple.quarantine /Applications/FeedbackRecorder.app

If it still will not open, download the app again, and check you took
the right one: Apple-silicon Macs need the arm64 file, Intel Macs need
the x64 file.


About updates
-------------

You will have to approve the app again after each update, and grant
Microphone and Screen Recording again.

That is the same cause as above. macOS recognises an app by its
signature, and an unsigned build gets a new one every time it is built,
so each update looks like an app your Mac has never seen before.


Where to get help
-----------------

https://github.com/magnuslandahl/FeedbackRecorder
