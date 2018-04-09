#!/bin/bash

#Required values:
#Team ID
TEAM_ID="THHR8L4QV3"
# Name of the app.
APP="Forsta Messenger"
# The path of the app to sign.
APP_PATH="builds/${APP}-mas-x64/${APP}.app"
# The path to the location to put the signed package.
RESULT_PATH="builds/${APP}.pkg"
# The name of certificates requested.
APP_KEY="3rd Party Mac Developer Application: Forsta, Inc ($TEAM_ID)"
INSTALLER_KEY="3rd Party Mac Developer Installer: Forsta, Inc ($TEAM_ID)"
# The path of plist files.
CHILD_PLIST="electron/child.plist"
PARENT_PLIST="electron/parent.plist"
LOGINHELPER_PLIST="electron/loginhelper.plist"

FRAMEWORKS_PATH="${APP_PATH}/Contents/Frameworks"

INFO_PLIST_PATH="${APP_PATH}/Contents/Info.plist"

# Insert TEAM_ID into App contents
if [ ! -d "$APP_PATH" ]; then
    echo "Application not found.  Execute \"make electron-mas\" first."
    exit
fi

if ! grep "$TEAM_ID" "$INFO_PLIST_PATH"; then
    echo "Inserting Team ID."
    sed -i '' "s/<dict>/<dict>\\"$'\n'"<key>    ElectronTeamID<\/key>\\"$'\n'"<string>    ${TEAM_ID}<\/string>/" "$INFO_PLIST_PATH"
fi

# Commence signing:
codesign -s "$APP_KEY" -f --entitlements "$CHILD_PLIST" "$FRAMEWORKS_PATH/Electron Framework.framework/Versions/A/Electron Framework"
codesign -s "$APP_KEY" -f --entitlements "$CHILD_PLIST" "$FRAMEWORKS_PATH/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib"
codesign -s "$APP_KEY" -f --entitlements "$CHILD_PLIST" "$FRAMEWORKS_PATH/Electron Framework.framework/Versions/A/Libraries/libnode.dylib"
codesign -s "$APP_KEY" -f --entitlements "$CHILD_PLIST" "$FRAMEWORKS_PATH/Electron Framework.framework"
codesign -s "$APP_KEY" -f --entitlements "$CHILD_PLIST" "$FRAMEWORKS_PATH/$APP Helper.app/Contents/MacOS/$APP Helper"
codesign -s "$APP_KEY" -f --entitlements "$CHILD_PLIST" "$FRAMEWORKS_PATH/$APP Helper.app/"
codesign -s "$APP_KEY" -f --entitlements "$CHILD_PLIST" "$FRAMEWORKS_PATH/$APP Helper EH.app/Contents/MacOS/$APP Helper EH"
codesign -s "$APP_KEY" -f --entitlements "$CHILD_PLIST" "$FRAMEWORKS_PATH/$APP Helper EH.app/"
codesign -s "$APP_KEY" -f --entitlements "$CHILD_PLIST" "$FRAMEWORKS_PATH/$APP Helper NP.app/Contents/MacOS/$APP Helper NP"
codesign -s "$APP_KEY" -f --entitlements "$CHILD_PLIST" "$FRAMEWORKS_PATH/$APP Helper NP.app/"
codesign -s "$APP_KEY" -f --entitlements "$LOGINHELPER_PLIST" "$APP_PATH/Contents/Library/LoginItems/$APP Login Helper.app/Contents/MacOS/$APP Login Helper"
codesign -s "$APP_KEY" -f --entitlements "$LOGINHELPER_PLIST" "$APP_PATH/Contents/Library/LoginItems/$APP Login Helper.app/"
codesign -s "$APP_KEY" -f --entitlements "$CHILD_PLIST" "$APP_PATH/Contents/MacOS/$APP"
codesign -s "$APP_KEY" -f --entitlements "$PARENT_PLIST" "$APP_PATH"

productbuild --component "$APP_PATH" /Applications --sign "$INSTALLER_KEY" "$RESULT_PATH"
