<!DOCTYPE html>
<html>
    <head>
        <meta charset="utf-8"/>
        <meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1"/>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0"/>
        <meta name="apple-mobile-web-app-capable" content="yes"/>

        <title>Install - Forsta</title>

        <link rel="manifest" href="/@static/manifest.json?v={{version}}"/>
        <link rel="stylesheet"
              href="https://fonts.googleapis.com/css?family=Lato:100,100i,300,300i,400,400i,700,700i,900,900i&subset=latin-ext"/>
        <link id="favicon" rel="shortcut icon" href="/@static/images/icon_256.png?v={{version}}"/>
        <link rel="stylesheet" type="text/css" href="/@static/semantic/semantic.css?v={{version}}"/>
        <link rel="stylesheet" type="text/css" href="/@static/stylesheets/install.css?v={{version}}"/>

        <script type="text/javascript" src="/@env.js?v={{version}}"></script>
        <script type="text/javascript" src="/@static/js/app/deps.js?v={{version}}"></script>
        <script type="text/javascript" src="/@static/semantic/semantic.js?v={{version}}"></script>
    </head>

    <body>
        <div id="f-too-many-devices" class="ui modal">
            <div class="header">
                Too many devices
            </div>
            <div class="image content">
                <div class="image"><i class="icon warning sign"></i></div>
                <div class="description">
                    Please remove one or more of your devices from the mobile
                    App and try again.
                </div>
            </div>
        </div>

        <div id="f-connection-error" class="ui modal">
            <div class="header">
                Connection Error
            </div>
            <div class="image content">
                <div class="image"><i class="icon warning sign"></i></div>
                <div class="description">
                    Sorry but there was a connection error.  Please try again later.
                </div>
            </div>
        </div>

        <main class="ui container segment raised">
            <h1 class="ui header">
                <img src="/@static/images/icon_128.png?v={{version}}"/>
                <div class="content">
                    Link Forsta Web to a Mobile App
                    <div class="sub header">
                        Verify your Identity with End-to-End Encryption.
                    </div>
                </div>
            </h1>

            <div class="ui attached segment blue">
                <div class="panel" data-step="start">
                    <div id="f-already-registered" class="ui message top warning hidden">
                        <i class="icon warning sign"></i>
                        This computer appears to already be registered.
                        <a href="/@">Click here to return to the messenger app</a> if you
                        reached this page mistakenly.
                    </div>

                        <div class="ui segment apps basic">
                            <div class="ui two column grid stackable">
                                <div class="column six wide">
                                  <div class=" ui segment basic" id="qr"></div>
                                </div>
                                <div class="column">
                                  <div class="ui segment blue">
                                      <ol class="directions">
                                        <li>Download and install one of our mobile apps from the links below</li>
                                        <li>Open and login to the Forsta app on your phone</li>
                                        <li>Tap the <span id="qr-code-links">Link to Web App</span> option from the 'more' menu in the upper right of the app</li>
                                        <li>Aim your device's camera at the QR code to scan it.</li>
                                      </ol>
                                  </div>
                                  <div class="ui grid two column">
                                      <div class="column center aligned">
                                          <a class="ui image badge" target="_blank" href="https://play.google.com/store/apps/details?id=io.forsta.relay&ah=p2dRwy36aXoF7mAqbP3TBYqi8YU">
                                          <img src="@static/images/google-play-badge.png?v={{version}}"/>
                                            </a>
                                      </div>
                                      <div class="column center aligned">
                                          <a class="ui image badge" target="_blank" href="mailto:support@forsta.io?subject=Apple%20App%20Request">
                                          <img src="@static/images/apple-app-store-badge.svg?v={{version}}"/>
                                          </a>
                                      </div>

                                  </div>
                                </div>
                            </div>
                        </div>
                    </div>
                <div class="panel" data-step="sync">
                    <h3 class="ui header">
                        <i class="icon hourglass half"></i>
                        <div class="content">
                            Generating Keys
                            <div class="sub header">
                                Creating security keys for this device...
                            </div>
                        </div>
                    </h3>

                    <div class="ui progress">
                        <div class="bar">
                            <div class="progress"></div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="ui steps four attached bottom mini">
                <div class="step" data-step="start">
                    <i class="icon qrcode"></i>
                    <div class="content">
                        <div class="title">Scan QR Code</div>
                        <div class="description">Verify this computer</div>
                    </div>
                </div>
                <div class="step" data-step="sync">
                    <i class="icon handshake"></i>
                    <div class="content">
                        <div class="title">Generate Keys</div>
                        <div class="description">Create unique security keys for this computer.</div>
                    </div>
                </div>
            </div>
        </main>
        <div class="pi">
          <a href="#" onclick="F.easter.registerAccount()">π</a>
        </div>
    </body>

    <script type="text/javascript" src="/@static/js/lib/signal.js?v={{version}}"></script>
    <script type="text/javascript" src="/@static/js/lib/textsecure.js?v={{version}}"></script>
    <script type="text/javascript" src="/@static/js/app/install.js?v={{version}}"></script>
</html>
