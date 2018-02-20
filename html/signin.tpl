<!DOCTYPE html>
<html>
    <head>
        <meta charset="utf-8"/>
        <meta http-equiv="X-UA-Compatible" content="IE=edge"/>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0"/>
        <meta name="apple-mobile-web-app-capable" content="yes"/>

        <title>Sign In - Forsta</title>

        <link rel="manifest" href="/@static/manifest.json?v={{version}}"/>
        <link id="favicon" rel="shortcut icon" href="/@static/images/icon_256.png?v={{version}}"/>
        <link rel="stylesheet" type="text/css" href="/@static/semantic/semantic{{minify_ext}}.css?v={{version}}"/>
        <link rel="stylesheet" type="text/css" href="/@static/stylesheets/signin.css?v={{version}}"/>

        <script type="text/javascript" src="/@env.js?v={{version}}"></script>
        <script type="text/javascript" src="/@static/js/app/deps{{minify_ext}}.js?v={{version}}"></script>
        <script type="text/javascript" src="/@static/semantic/semantic{{minify_ext}}.js?v={{version}}"></script>
    </head>

    <body>
        <main class="ui grid middle aligned center aligned">
            <div class="column">
                <div class="ui segment raised">
                    <div class="ui grid two column stackable">
                        <div class="f-splash column">
                            <h1>Hello</h1>
                        </div>
                        <div class="column">
                            <div class="ui segment raised blue very padded">
                                <h3 class="ui header">
                                    <img src="/@static/images/icon_128.png?v={{version}}"/>
                                    <div class="content">
                                        Forsta Secure Messenger Sign In
                                        <div class="sub header">
                                            You're almost there, enter or select your username below...
                                        </div>
                                    </div>
                                </h3>


                                <div class="ui attached segment blue">
                                    asdf
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
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </main>
    </body>

    <script type="text/javascript" src="/@static/js/lib/signal{{minify_ext}}.js?v={{version}}"></script>
    <script type="text/javascript" src="/@static/js/lib/relay{{minify_ext}}.js?v={{version}}"></script>
    <script type="text/javascript" src="/@static/js/app/signin{{minify_ext}}.js?v={{version}}"></script>
</html>
