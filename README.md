relay-web-app
========
Forsta web messaging app.  A fork of Whisper systems' Signal Chrome extension.

[![Commit Activity](https://img.shields.io/github/commit-activity/w/ForstaLabs/relay-web-app.svg)](https://github.com/ForstaLabs/relay-web-app)
[![Change Log](https://img.shields.io/badge/change-log-blue.svg)](https://github.com/ForstaLabs/relay-web-app/blob/master/CHANGELOG.md)


Building
--------

    make


Running
--------

    make run


Dev
--------
The UI must be built for proper function.  To avoid having to call `make` 
repetitively you can use `make watch` to automatically rebuild and install
the changed sources.


Embedded Client
--------
For installation in 3rd party sites you can include an `<iframe>` of our embedded client.
The user is `/@embed` and takes various parameters to tune the session.  The only
required argument is `token` which must match an organizational `ephermeral-user-token`.

For example:
```html
<iframe src="http://localhost:1080/@embed?token=TESTING&first_name=Demo&email=foo@bar.com&to=@support:forsta.io"></iframe>
```

And with calling support (NOTE the `allow` attribute required for new browsers):
```html
<iframe allow="camera; microphone" src="https://app.forsta.io/@embed?token=TESTING&allowCalling"></iframe>
```


### Query Arguments
 * **to**: Distribution (tags) to start thread with.
 * **token**: Ephemeral user token for the organization.
 * **theme**: Theme for interface (e.g. minimal, dark, pink, plaid).
 * **first_name**: First name of ephemeral user.
 * **last_name**: Last name of ephemeral user.
 * **email**: Email of ephemeral user.
 * **phone**: Phone of ephemeral user.
 * **allowCalling**: Enables video calling support (no value required).
 * **forceScreenSharing**: Forces video calling support to ONLY support screen sharing (no value required).
 * **threadId**: Hardcode the `threadId` in UUID format (EXPERT USE ONLY).
 * **disableCommands**: Disable user commands like `/help`.
 * **logLevel**: Optional filter for `console.[debug, info, warn, error]`.


License
--------
Licensed under the GPLv3: http://www.gnu.org/licenses/gpl-3.0.html

* Copyright 2015-2016 Open Whisper Systems
* Copyright 2017-2019 Forsta Inc.
