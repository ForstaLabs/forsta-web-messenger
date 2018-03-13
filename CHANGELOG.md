# Change Log

## [0.64.0]
### Added
- Trusted Identity Support: Lock a contact's identity so you will be notified
  of any suspicious activity.


## [0.63.0]
### Fixed
- Multiple `literal` sections in markdown processor.

### Added
- Auto completer for `/commands` in compose view.


## [0.62.0]
### Added
- Message sync engine for keeping multiple devices consistent.  Allows new devices to
  see messages sent before their time by getting the prior catalog of content from
  any of their other devices.


## [0.61.0]
### Added
- New Sign in page /@signin


## [0.60.0]
### Fixed
- Various bugs in signal session and prekey handling.


## [0.59.0]
### Added
- Archived message view
- Extended search options: `from:user` and `to:user`


## [0.58.0]
### Added
- Message searching


## [0.57.0]
### Added
- Track recently used Emojis in picker widget.
- Settings page for showing detailed app info, adjustment of notifications and
  privacy settings.
- @mention support for notifying a subset of users in a conversation.
### Changed
- Moved all top level menus to top right of screen.
- Regulate looping videos (including giphy) to stop after some time/iterations.
- Renamed "People" menu item to "Users"
### Fixed
- Attachment downloads for Firefox.


## [0.56.0]
### Changed
- Upgraded signal protocol


## [0.55.0]
### Fixed
- General fixes for Google contact importing


## [0.54.0]
### Added
- Google contact discovery


## [0.53.0]
### Changed
- Redesigned message input UI.
### Added
- Emoji picker widget/button.
- Giphy browser button


## [0.52.0]
### Changed
- Thread notices are now in a widget in the right side panel.
### Fixed
- Better word wrapping for non web-kit browsers (e.g Firefox).
- Detection of expired session and redirect to login page.


## [0.51.0]
### Added
- Navigation attention light for mobile devices to indicate when new
  messages are unread in other threads.
### Changed
- Default to navigation view for mobile devices.


## [0.50.0]
### Added
- Pre-message feature:  Send an SMS invite to non-users and let them check-in
  after they sign-up to fetch pre-messages sent to them beforehand.
### Changed
- Use cards are now modals for mobile devices and in cases where popups do not
  have enough real-estate to display properly.


## [0.49.0]
### Added
- Monitor address support (e.g. vault support)


## [0.48.0]
### Fixed
- Giphy autoplay support on mobile Android.
- Support of non-mobile touch screen devices.
- Fixed dropped HTML messages received in background service worker.


## [0.47.0]
### Added
- Add this changelog file.
- Add `pin` and `unpin` commands.
### Changed
- `/giphy` now provides a picker instead of random selection.


[unreleased]: https://github.com/ForstaLabs/relay-web-app/tree/master
[0.64.0]: https://github.com/ForstaLabs/relay-web-app/tree/v0.64.0
[0.63.0]: https://github.com/ForstaLabs/relay-web-app/tree/v0.63.0
[0.62.0]: https://github.com/ForstaLabs/relay-web-app/tree/v0.62.0
[0.61.0]: https://github.com/ForstaLabs/relay-web-app/tree/v0.61.0
[0.60.0]: https://github.com/ForstaLabs/relay-web-app/tree/v0.60.0
[0.59.0]: https://github.com/ForstaLabs/relay-web-app/tree/v0.59.0
[0.58.0]: https://github.com/ForstaLabs/relay-web-app/tree/v0.58.0
[0.57.0]: https://github.com/ForstaLabs/relay-web-app/tree/v0.57.0
[0.56.0]: https://github.com/ForstaLabs/relay-web-app/tree/v0.56.0
[0.55.0]: https://github.com/ForstaLabs/relay-web-app/tree/v0.55.0
[0.54.0]: https://github.com/ForstaLabs/relay-web-app/tree/v0.54.0
[0.53.0]: https://github.com/ForstaLabs/relay-web-app/tree/v0.53.0
[0.52.0]: https://github.com/ForstaLabs/relay-web-app/tree/v0.52.0
[0.51.0]: https://github.com/ForstaLabs/relay-web-app/tree/v0.51.0
[0.50.0]: https://github.com/ForstaLabs/relay-web-app/tree/v0.50.0
[0.49.0]: https://github.com/ForstaLabs/relay-web-app/tree/v0.49.0
[0.48.0]: https://github.com/ForstaLabs/relay-web-app/tree/v0.48.0
[0.47.0]: https://github.com/ForstaLabs/relay-web-app/tree/v0.47.0
