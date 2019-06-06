
Config.json provides a concise way to configure and brand relay-web-app and its view components and 
global settings, without having to modify code directly. The basic design is to place images in
/images and .scss files in /themes and applying them based on the config.json spec.

```
Config.json spec: 
{
    // Sets the name of the app on the sign in page, some document titles and on sign 
    // in page form headers
    "app_name": "ACME",

    // The forsta theme to be applied. Options are : dark, 
    // default, dense, hacker, minimal, pink, and plaid. 
    "default_theme": "plaid",

	// Represents an array of .scss files to be applied from the /themes folder.
	“themes”: [ “your-scss-filename”, “another-scss-filename” ]

    // The logo for the sign in page header toolbar and the chat view header toolbar
    "logo": "logo_white.png”

	// The icons that will appear on the browser tab. “Normal” is for when no unread 
    // messages are detected. “Unread” vice versa.
    "favicons": {
        "normal": "favicon.png",
        "unread": "favicon_unread.png"
    },
    "signin": {
        // This logo appears next to the “Sign into [app_name] text on the sign in page.
        "signinLogo": "badge_logo.png",
	
        // A set of splash images to appear on the left next to the sign in form. 
        // Images are randomly selected on page load and will fade from one image to
        // another randomly selected image every 30 seconds.
        "splashImages": [
            "custom-photo-1.jpeg",
            "custom-photo-2.jpeg",
            "custom-photo-3.jpeg",
            "custom-photo-4.jpeg",
            "custom-photo-5.jpeg"
        ],

        // The logo shown next to the sign in form over the splash images from the
        // previous key. 
        "splashLogo": "logo_white.png"
    }
```
