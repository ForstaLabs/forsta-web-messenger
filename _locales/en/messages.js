function __relay_locale() {
    return {
        "debugLogExplanation": {
          "message": "This log will be posted publicly online for contributors to view. You may examine and edit it before submitting."
        },
        "reportIssue": {
          "message": "Report an issue",
          "description": "Link to open the issue tracker"
        },
        "gotIt": {
          "message": "Got it!",
          "description": "Label for a button that dismisses a dialog. The user clicks it to confirm that they understand the message in the dialog."
        },
        "submit": {
          "message": "Submit"
        },
        "verifyContact": {
          "message": "You may wish to $tag_start$ verify $tag_end$ this contact.",
          "description": "Use $tag_start$ and $tag_end$ to wrap the word or phrase in this sentence that the user should click on in order to navigate to the verification screen. These placeholders will be replaced with appropriate HTML code.",
          "placeholders": {
            "tag_start": {
              "content": "<a class='verify' href='#'>"
            },
            "tag_end": {
              "content": "</a>"
            }
          }
        },
        "acceptNewKey": {
          "message": "Accept",
          "description": "Label for a button to accept a new identity key"
        },
        "verify": {
          "message": "Verify"
        },
        "newIdentity": {
          "message": "New Identity",
          "description": "Header for a key change dialog"
        },
        "identityChanged": {
          "message": "This contact is using a new Forsta Relay identity. This could either mean that someone is trying to intercept your communication, or this contact simply re-installed Forsta Relay. You may wish to verify their new identity key below."
        },
        "outgoingKeyConflict": {
          "message": "This contact's identity key has changed. Click to process and display."
        },
        "incomingKeyConflict": {
          "message": "Received message with unknown identity key. Click to process and display."
        },
        "incomingError": {
          "message": "Error handling incoming message."
        },
        "unsupportedAttachment": {
          "message": "Unsupported attachment type. Click to save.",
          "description": "Displayed for incoming unsupported attachment"
        },
        "unsupportedFileType": {
          "message": "Unsupported file type",
          "description": "Displayed for outgoing unsupported attachment"
        },
        "fileSizeWarning": {
          "message": "Sorry, the selected file exceeds message size restrictions."
        },
        "disconnected": {
          "message": "Disconnected"
        },
        "submitDebugLog": {
          "message": "Submit debug log",
          "description": "Menu item and header text for debug log modal, title case."
        },
        "searchForPeopleOrGroups": {
          "message": "Search...",
          "description": "Placeholder text in the search input"
        },
        "welcomeToSignal": {
          "message": "Welcome to Forsta Relay"
        },
        "selectAContact": {
          "message": "Select a contact or group to start chatting."
        },
        "ok": {
          "message": "OK"
        },
        "cancel": {
          "message": "Cancel"
        },
        "failedToSend": {
          "message": "Failed to send to some recipients. Check your network connection."
        },
        "error": {
          "message": "Error"
        },
        "resend": {
          "message": "Resend"
        },
        "messageDetail": {
            "message": "Message Detail"
        },
        "from": {
            "message": "From",
            "description": "Label for the sender of a message"
        },
        "to": {
            "message": "To",
            "description": "Label for the receiver of a message"
        },
        "sent": {
            "message": "Sent",
            "description": "Label for the time a message was sent"
        },
        "received": {
            "message": "Received",
            "description": "Label for the time a message was received"
        },
        "sendMessage": {
            "message": "Send a message",
            "description": "Placeholder text in the message entry field"
        },
        "members": {
          "message": "Members"
        },
        "resetSession": {
            "message": "Reset session",
            "description": "This is a menu item for resetting the session, using the imperative case, as in a command."
        },
        "verifyIdentity": {
            "message": "Verify Identity"
        },
        "verifySafetyNumbers": {
            "message": "Verify safety numbers"
        },
        "theirIdentity": {
            "message": "Their identity",
            "description": "Label for someone else's identity key. They is used here as a gender-neutral third-person singular."
        },
        "yourIdentity": {
            "message": "Your identity",
            "description": "Label for the user's own identity key."
        },
        "theirIdentityUnknown": {
            "message": "You haven't exchanged any messages with this contact yet. Their identity will be available after the first message."
        },
        "deleteMessages": {
            "message": "Delete messages",
            "description": "Menu item for deleting messages, title case."
        },
        "deleteConversationConfirmation": {
            "message": "Permanently delete this conversation?",
            "description": "Confirmation dialog text that asks the user if they really wish to delete the conversation. Answer buttons use the strings 'ok' and 'cancel'. The deletion is permanent, i.e. it cannot be undone."
        },
        "sessionEnded": {
            "message": "Secure session reset",
            "description": "This is a past tense, informational message. In other words, your secure session has been reset."
        },
        "installWelcome": {
            "message": "Welcome to Forsta Relay",
            "description": "Welcome title on the install page"
        },
        "installTagline": {
            "message": "Privacy is possible. Forsta Relay makes it easy.",
            "description": "Tagline displayed under installWelcome on the install page"
        },
        "installGetStartedButton": {
            "message": "Get started"
        },
        "installSignalLink": {
            "message": "First, install <a $a_params$>Forsta Relay</a> on your Android phone.<br /> We'll link your devices and keep your messages in sync.",
            "description": "Prompt the user to install Forsta Relay on Android before linking",
            "placeholders": {
              "a_params": {
                "content": "$1",
                "example": "href='http://example.com'"
              }
            }
        },
        "installSignalLinks": {
            "message": "First, install Forsta Relay on your <a $play_store$>Android</a> or <a $app_store$>iPhone</a>.<br /> We'll link your devices and keep your messages in sync.",
            "description": "Prompt the user to install Forsta Relay on their phone before linking",
            "placeholders": {
              "play_store": {
                "content": "$1",
                "example": "href='http://example.com'"
              },
              "app_store": {
                "content": "$2",
                "example": "href='http://example.com'"
              }
            }
        },
        "installGotIt": {
            "message": "Got it",
            "description": "Button for the user to confirm that they have Forsta Relay installed."
        },
        "installIHaveSignalButton": {
            "message": "I have Forsta Relay for Android",
            "description": "Button for the user to confirm that they have Forsta Relay for Android"
        },
        "installFollowUs": {
            "message": "<a $a_params$>Follow us</a> for updates about multi-device support for iOS.",
            "placeholders": {
              "a_params": {
                "content": "$1",
                "example": "href='http://example.com'"
              }
            }
        },
        "installAndroidInstructions": {
            "message": "Open Forsta Relay on your phone and navigate to Settings > Linked devices. Tap the button to add a new device, then scan the code above."
        },
        "installConnecting": {
            "message": "Connecting...",
            "description": "Displayed when waiting for the QR Code"
        },
        "installConnectionFailed": {
            "message": "Failed to connect to server.",
            "description": "Displayed when we can't connect to the server."
        },
        "installGeneratingKeys": {
            "message": "Generating Keys"
        },
        "installSyncingGroupsAndContacts": {
            "message": "Syncing groups and contacts"
        },
        "installComputerName": {
            "message": "This computer's name will be",
            "description": "Text displayed before the input where the user can enter the name for this device."
        },
        "installLinkingWithNumber": {
            "message": "Linking with",
            "description": "Text displayed before the phone number that the user is in the process of linking with"
        },
        "installFinalButton": {
            "message": "Looking good",
            "description": "The final button for the install process, after the user has entered a name for their device"
        },
        "installTooManyDevices": {
            "message": "Sorry, you have too many devices linked already. Try removing some."
        },
        "settings": {
            "message": "Settings",
            "description": "Menu item and header for global settings"
        },
        "theme": {
            "message": "Theme",
            "description": "Header for theme settings"
        },
        "notifications": {
            "message": "Notifications",
            "description": "Header for notification settings"
        },
        "notificationSettingsDialog": {
            "message": "When messages arrive, display notifications that reveal:",
            "description": "Explain the purpose of the notification settings"
        },
        "disableNotifications": {
            "message": "Disable notifications",
            "description": "Label for disabling notifications"
        },
        "nameAndMessage": {
            "message": "Both sender name and message",
            "description": "Label for setting notifications to display name and message text"
        },
        "noNameOrMessage": {
            "message": "Neither name nor message",
            "description": "Label for setting notifications to display no name and no message text"
        },
        "nameOnly": {
            "message": "Only sender name",
            "description": "Label for setting notifications to display sender name only"
        },
        "newMessage": {
            "message": "New Message",
            "description": "Displayed in notifications for only 1 message"
        },
        "newMessages": {
            "message": "New Messages",
            "description": "Displayed in notifications for multiple messages"
        },
        "restartSignal": {
            "message": "Restart Forsta Relay",
            "description": "Menu item for restarting the program."
        },
        "messageNotSent": {
            "message": "Message not sent.",
            "description": "Informational label, appears on messages that failed to send"
        },
        "showMore": {
            "message": "Details",
            "description": "Displays the details of a key change"
        },
        "showLess": {
            "message": "Hide details",
            "description": "Hides the details of a key change"
        },
        "learnMore": {
            "message": "Learn more about verifying keys.",
            "description": "Text that links to a support article on verifying identity keys"
        },
        "expiredWarning": {
            "message": "This version of Forsta Relay has expired. Please upgrade to the latest version to continue messaging.",
            "description": "Warning notification that this version of the app has expired"
        },
        "upgrade": {
            "message": "Upgrade",
            "description": "Label text for button to upgrade the app to the latest version"
        },
        "mediaMessage": {
            "message": "Media message",
            "description": "Description of a message that has an attachment and no text, displayed in the conversation list as a preview."
        },
        "unregisteredUser": {
            "message": "Number is not registered",
            "description": "Error message displayed when sending to an unregistered user."
        },
        "sync": {
            "message": "Contacts",
            "description": "Label for contact and group sync settings"
        },
        "syncExplanation": {
            "message": "Import all Forsta Relay groups and contacts from your mobile device.",
            "description": "Explanatory text for sync settings"
        },
        "lastSynced": {
            "message": "Last import at",
            "description": "Label for date and time of last sync operation"
        },
        "syncNow": {
            "message": "Import now",
            "description": "Label for a button that syncs contacts and groups from your phone"
        },
        "syncing": {
            "message": "Importing...",
            "description": "Label for a disabled sync button while sync is in progress."
        },
        "syncFailed": {
            "message": "Import failed. Make sure your computer and your phone are connected to the internet.",
            "description": "Informational text displayed if a sync operation times out."
        },
        "timestamp_s": {
           "description": "Brief timestamp for messages sent less than a minute ago. Displayed in the conversation list and message bubble.",
           "message": "now"
        },
        "timestamp_m": {
           "description": "Brief timestamp for messages sent about one minute ago. Displayed in the conversation list and message bubble.",
           "message": "1 minute"
        },
        "timestamp_h": {
           "description": "Brief timestamp for messages sent about one minute ago. Displayed in the conversation list and message bubble.",
           "message": "1 hour"
        },
        "timestampFormat_M": {
           "description": "Timestamp format string for displaying month and day (but not the year) of a date within the current year, ex: use 'MMM D' for 'Aug 8', or 'D MMM' for '8 Aug'.",
           "message": "MMM D"
        },
        "unblockToSend": {
          "message": "Unblock this contact to send a message.",
          "description": "Brief message shown when trying to message a blocked number"
        },
        "youChangedTheTimer": {
          "message": "You set the timer to $time$.",
          "description": "Message displayed when you change the message expiration timer in a conversation.",
          "placeholders": {
            "time": {
              "content": "$1",
              "example": "10m"
            }
          }
        },
        "theyChangedTheTimer": {
          "message": "$name$ set the timer to $time$.",
          "description": "Message displayed when someone else changes the message expiration timer in a conversation.",
          "placeholders": {
            "name": {
              "content": "$1",
              "example": "Bob"
            },
            "time": {
              "content": "$2",
              "example": "10m"
            }
          }
        },
        "timerOption_0_seconds": {
          "message": "off",
          "description": "Label for option to turn off message expiration in the timer menu"
        },
        "timerOption_5_seconds": {
          "message": "5 seconds",
          "description": "Label for a selectable option in the message expiration timer menu"
        },
        "timerOption_10_seconds": {
          "message": "10 seconds",
          "description": "Label for a selectable option in the message expiration timer menu"
        },
        "timerOption_30_seconds": {
          "message": "30 seconds",
          "description": "Label for a selectable option in the message expiration timer menu"
        },
        "timerOption_1_day": {
          "message": "1 day",
          "description": "Label for a selectable option in the message expiration timer menu"
        },
        "timerOption_1_week": {
          "message": "1 week",
          "description": "Label for a selectable option in the message expiration timer menu"
        },
        "disappearingMessages": {
          "message": "Disappearing messages",
          "description": "Conversation menu option to enable disappearing messages"
        },
        "timerOption_0_seconds_abbreviated": {
          "message": "off",
          "description": "Short format indicating current timer setting in the conversation list snippet"
        },
        "timerOption_5_seconds_abbreviated": {
          "message": "5s",
          "description": "Very short format indicating current timer setting in the conversation header"
        },
        "timerOption_10_seconds_abbreviated": {
          "message": "10s",
          "description": "Very short format indicating current timer setting in the conversation header"
        },
        "timerOption_30_seconds_abbreviated": {
          "message": "30s",
          "description": "Very short format indicating current timer setting in the conversation header"
        },
        "timerOption_1_minute_abbreviated": {
          "message": "1m",
          "description": "Very short format indicating current timer setting in the conversation header"
        },
        "timerOption_5_minutes_abbreviated": {
          "message": "5m",
          "description": "Very short format indicating current timer setting in the conversation header"
        },
        "timerOption_30_minutes_abbreviated": {
          "message": "30m",
          "description": "Very short format indicating current timer setting in the conversation header"
        },
        "timerOption_1_hour_abbreviated": {
          "message": "1h",
          "description": "Very short format indicating current timer setting in the conversation header"
        },
        "timerOption_6_hours_abbreviated": {
          "message": "6h",
          "description": "Very short format indicating current timer setting in the conversation header"
        },
        "timerOption_12_hours_abbreviated": {
          "message": "12h",
          "description": "Very short format indicating current timer setting in the conversation header"
        },
        "timerOption_1_day_abbreviated": {
          "message": "1d",
          "description": "Very short format indicating current timer setting in the conversation header"
        },
        "timerOption_1_week_abbreviated": {
          "message": "1w",
          "description": "Very short format indicating current timer setting in the conversation header"
        },
        "timerSetTo": {
          "message": "Timer set to $time$",
          "description": "Displayed in the conversation list when the timer is updated.",
          "placeholders": {
            "time": {
              "content": "$1",
              "example": "1w"
            }
          }
        },
        "safetyNumbersSettingHeader": {
          "message": "Safety numbers approval",
          "description": "Description for safety numbers setting"
        },
        "safetyNumbersSettingDescription": {
          "message": "Require approval of new safety numbers when they change.",
          "description": "Description for safety numbers setting"
        },
        "keychanged": {
          "message": "$name$'s safety numbers have changed",
          "description": "",
          "placeholders": {
            "name": {
              "content": "$1",
              "example": "John"
            }
          }
        },
        "yourSafetyNumberWith": {
          "message": "Your safety numbers with $name$",
          "description": "Heading for safety number view",
          "placeholders": {
            "name": {
              "content": "$1",
              "example": "John"
            }
          }
        }
    };
}
