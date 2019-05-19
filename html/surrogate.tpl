<!DOCTYPE html>
<html class="F O R S T A">
    <head>
        <meta charset="utf-8"/>
        <meta http-equiv="X-UA-Compatible" content="IE=edge"/>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0"/>
        <meta name="apple-mobile-web-app-capable" content="yes"/>

        <title>Forsta</title>

        <link id="favicon" rel="shortcut icon" href="/@static/images/favicon.png?v={{version}}"/>
        <link rel="stylesheet" type="text/css" href="/@static/semantic/semantic.min.css?v={{version}}"/>
        <link rel="stylesheet" type="text/css" href="/@static/stylesheets/surrogate.css?v={{version}}"/>

        <script defer type="text/javascript" src="/@env.js?v={{version}}"></script>
        <script defer type="text/javascript" src="/@static/js/app/deps{{minify_ext}}.js?v={{version}}"></script>
        <script defer type="text/javascript" src="/@static/semantic/semantic{{minify_ext}}.js?v={{version}}"></script>
        <script defer type="text/javascript" src="/@static/js/lib/relay{{minify_ext}}.js?v={{version}}"></script>
        <script defer type="text/javascript" src="/@static/js/app/surrogate{{minify_ext}}.js?v={{version}}"></script>
    </head>

    <body>
        <div class="f-loading ui dimmer active">
            <div class="ui progress attached top indicating">
                <div class="bar"></div>
            </div>
            <div class="ui loader text indeterminate">Loading...</div>
        </div>

        <div id="f-version-update-nag" class="ui nag">
            <span class="title">
                <i class="icon line chart"></i>
                An updated version of this site is available!
            </span>
            <button class="ui button mini compact blue">Refresh Now</button>
            <i class="icon close"></i>
        </div>

        <main></main>
    </body>
</html>
