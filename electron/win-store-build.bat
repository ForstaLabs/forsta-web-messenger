rm -fr output
electron-windows-store ^
--input-directory "..\\builds\\Forsta Messenger-win32-x64" ^
--output-directory "output\\Forsta Messenger" ^
--flatten "true" ^
--windows-kit="C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.16299.0\\x64" ^
--package-version "0.68.0.0" ^
--package-name "ForstaInc.ForstaMessenger" ^
--package-display-name "Forsta Messenger" ^
--package-description "Secure messaging for business" ^
--package-background-color "#000000" ^
--package-executable "app\Forsta Messenger.exe" ^
--identity-name "ForstaInc.ForstaMessenger" ^
--publisher "CN=Forsta Labs, O=Forsta Inc, C=US, S=Idaho" ^
--publisher-display-name "Forsta Inc" ^
--assets "windowsAssets" ^
--dev-cert "windowsAssets\\ForstaDevCert.pfx" ^
--cert-pass "Radiation!"
