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
                            <div class="backdrop"></div>
                            <div class="foreground">
                                <img class="logo" src="/@static/images/logo_just_text.svg?v={{version}}"/>
                                <h3>Secure Messaging Platform</h3>
                                <div class="filler not-small"></div>
                                <p class="not-small"><b>You're almost there!</b></p>
                                <p class="not-small">Select or enter your Forsta username on the right panel <i class="icon right arrow"></i></p>
                                <div class="filler not-small"></div>
                                <p class="not-small"><small>If your having trouble signing in or just want to talk to a human being <a href="https://forsta.zendesk.com/hc/en-us/requests/new" target="_blank">contact our support team</a>.</small></p>
                            </div>
                        </div>

                        <div class="f-form column">
                            <h2 class="ui header">
                                <img src="/@static/images/icon_128.png?v={{version}}"/>
                                <div class="content">
                                    Sign in to Forsta!
                                    <div class="sub header">
                                        <small>Enter your username and click Next to receive your SMS sign-in code...</small>
                                    </div>
                                </div>
                            </h2>
                            <div class="ui form">
                                <div class="field required">
                                    <label>Username</label>
                                    <input type="text" placeholder="@user:organization"
                                           autocapitalize="off" autocorrect="off"/>
                                </div>
                                <div class="ui button submit blue fluid">Next</div>
                            </div>
                            <div class="filler"></div>
                            <small><a href="/forgot">Forgot your username?</a></small>
                            <div class="ui message mini">By completing sign-in you are agreeing to our
                                <a href="https://forsta.io/terms" target="_blank">Terms of Use Policy</a>
                                and our use of browser cookies.
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
