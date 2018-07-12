<!DOCTYPE html>
<html class="F O R S T A">
    <head>
        <meta charset="utf-8"/>
        <meta http-equiv="X-UA-Compatible" content="IE=edge"/>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0"/>
        <meta name="apple-mobile-web-app-capable" content="yes"/>

        <title>Forsta</title>

        <link rel="manifest" href="/@static/manifest.json?v={{version}}"/>
        <link id="favicon" rel="shortcut icon" href="/@static/images/favicon.png?v={{version}}"/>
        <link rel="stylesheet" type="text/css" href="/@static/semantic/semantic.min.css?v={{version}}"/>
        <link rel="stylesheet" type="text/css" href="/@static/stylesheets/embed.css?v={{version}}"/>

        <script defer type="text/javascript" src="/@env.js?v={{version}}"></script>
        <script defer type="text/javascript" src="/@static/js/app/deps{{minify_ext}}.js?v={{version}}"></script>
        <script defer type="text/javascript" src="/@static/semantic/semantic{{minify_ext}}.js?v={{version}}"></script>
        <script defer type="text/javascript" src="/@static/js/lib/signal{{minify_ext}}.js?v={{version}}"></script>
        <script defer type="text/javascript" src="/@static/js/lib/relay{{minify_ext}}.js?v={{version}}"></script>
        <script defer type="text/javascript" src="/@static/js/app/embed{{minify_ext}}.js?v={{version}}"></script>
    </head>

    <body>
        <div class="ui dimmer inverted active">
            <div class="ui loader text indeterminate">Initiating secure communications...</div>
        </div>

        <main>
            <section>
                <div id="f-thread-stack"></div>
            </section>
        </main>
    </body>
</html>
