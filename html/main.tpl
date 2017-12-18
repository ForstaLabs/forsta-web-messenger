<!DOCTYPE html>
<html>
    <head>
        <meta charset="utf-8"/>
        <meta http-equiv="X-UA-Compatible" content="IE=edge"/>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0"/>
        <meta name="apple-mobile-web-app-capable" content="yes"/>

        <title>Forsta</title>

        <link rel="manifest" href="/@static/manifest.json?v={{version}}"/>
        <link id="favicon" rel="shortcut icon" href="/@static/images/favicon.png?v={{version}}"/>
        <link rel="stylesheet" type="text/css" href="https://cdn.quilljs.com/1.3.1/quill.snow.css"/>
        <link rel="stylesheet" type="text/css" href="/@static/semantic/semantic.min.css?v={{version}}"/>
        <link rel="stylesheet" type="text/css" href="/@static/stylesheets/main.css?v={{version}}"/>

        <script type="text/javascript" src="/@env.js?v={{version}}"></script>
        <script type="text/javascript" src="/@static/js/app/deps{{minify_ext}}.js?v={{version}}"></script>
        <script type="text/javascript" src="/@static/semantic/semantic{{minify_ext}}.js?v={{version}}"></script>
        <script type="text/javascript" src="https://www.gstatic.com/firebasejs/4.6.2/firebase.js"></script>
        <script type="text/javascript" src="https://cdn.quilljs.com/1.3.1/quill.min.js"></script>
    </head>

    <body>
        <div class="f-loading ui dimmer active">
            <div class="ui progress attached top indicating">
                <div class="bar"></div>
            </div>
            <div class="ui loader text indeterminate">Loading...</div>
        </div>

        <header id="f-header-view">
            <div class="ui menu inverted"></div>
        </header>

        <main>
            <nav>
                <div title="Start conversation" class="f-start-new fab-button f-closed">
                    <i class="icon plus blue"></i>
                    <i class="icon pencil"></i>
                </div>
                <div style="display: none;" class="f-start-new fab-button f-opened">
                    <i class="f-complete icon ellipsis horizontal grey off"></i>
                    <i title="Select recipients and then click here."
                       class="f-complete icon checkmark grey off"></i>
                    <i class="f-cancel icon close red"><label>Cancel</label></i>
                    <i class="f-invite icon mobile orange"><label>Invite by SMS</label></i>
                    <i class="f-support icon doctor amber"><label>Talk with support</label></i>
                </div>

                <div class="ui basic segment inverted">
                    
                    <div id="f-notifications-message"
                         class="ui message warning icon mini hidden">
                        <i class="icon outline alarm mute"></i>
                        <div class="content">
                            <div class="header">
                                Notifications are not enabled.
                            </div>
                            <p>Would you like to enable them?</p>
                            <button class="ui button mini blue">Request Permission</button>
                        </div>
                    </div>

                    <div id="f-new-thread-panel">
                        <div class="ui segment red">
                            <div class="f-header-menu ui menu borderless fitted attached">
                                <div class="menu left">
                                    <div class="item header">
                                        <i class="icon pencil big grey"></i>
                                        Start
                                    </div>
                                    <div class="item ui dropdown inline">
                                        <input type="hidden" name="threadType"/>
                                        <div class="text">Conversation</div>
                                        <i class="dropdown icon"></i>
                                        <div class="menu">
                                            <div class="item active">Conversation</div>
                                            <div class="item">Announcement</div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div class="f-start-dropdown ui multiple dropdown">
                                <input type="text" name="tags"/>
                                <div class="text"></div>
                                <div class="menu">
                                    <div class="ui input search icon">
                                        <i class="icon search"></i>
                                        <input autocapitalize="none" type="text" name="search"
                                               placeholder="Enter a name..."/>
                                    </div>
                                    <div class="scrolling menu"></div>
                                </div>

                                <div class="ui dimmer inverted">
                                    <div class="ui loader"></div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div id="f-nav-panel">
                        <div class="ui dimmer page"></div>
                    </div>
                </div>
            </nav>

            <section>
                <div id="f-thread-stack"></div>
            </section>
        </main>
    </body>

    <script type="text/javascript" src="/@static/js/lib/signal{{minify_ext}}.js?v={{version}}"></script>
    <script type="text/javascript" src="/@static/js/lib/relay{{minify_ext}}.js?v={{version}}"></script>
    <script type="text/javascript" src="/@static/js/app/main{{minify_ext}}.js?v={{version}}"></script>
</html>
