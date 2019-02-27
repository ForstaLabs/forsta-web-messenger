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
        <link rel="stylesheet" type="text/css" href="/@static/semantic/semantic.min.css?v={{version}}" media="screen"/>
        <link rel="stylesheet" type="text/css" href="/@static/stylesheets/main.css?v={{version}}" media="screen"/>

        <script defer type="text/javascript" src="/@env.js?v={{version}}"></script>
        <script defer type="text/javascript" src="/@static/js/app/deps{{minify_ext}}.js?v={{version}}"></script>
        <script defer type="text/javascript" src="/@static/semantic/semantic{{minify_ext}}.js?v={{version}}"></script>
        <script defer type="text/javascript" src="https://www.gstatic.com/firebasejs/5.7.0/firebase-app.js"></script>
        <script defer type="text/javascript" src="https://www.gstatic.com/firebasejs/5.7.0/firebase-messaging.js"></script>
        <script defer type="text/javascript" src="/@static/js/lib/signal{{minify_ext}}.js?v={{version}}"></script>
        <script defer type="text/javascript" src="/@static/js/lib/relay{{minify_ext}}.js?v={{version}}"></script>
        <script defer type="text/javascript" src="/@static/js/app/main{{minify_ext}}.js?v={{version}}"></script>
    </head>

    <body>
        <div class="f-loading ui dimmer active">
            <div class="ui progress attached top indicating">
                <div class="bar"></div>
            </div>
            <div class="ui loader text indeterminate">Loading...</div>
        </div>

        <div id="f-notifications-nag" class="ui nag">
            <span class="title">
                <i class="icon outline alarm"></i>
                Need permission to use notifications:
            </span>
            <button class="ui button mini compact blue">Enable Notifications</button>
            <i class="icon close"></i>
        </div>

        <div id="f-version-update-nag" class="ui nag">
            <span class="title">
                <i class="icon line chart"></i>
                An updated version of this site is available!
            </span>
            <button class="ui button mini compact blue">Refresh Now</button>
            <i class="icon close"></i>
        </div>

        <div id="f-sync-request" class="ui nag">
            <span class="title">
                <i class="icon refresh loading"></i>
                <span class="f-msg"></span>
            </span>
            <i class="icon close"></i>
        </div>

        <header id="f-header-view">
            <div class="ui menu inverted"></div>
        </header>

        <main>
            <nav class="expanded">
                <div title="Start conversation" class="f-start-new fab-button f-closed">
                    <i class="icon plus blue"></i>
                    <i class="icon pencil"></i>
                </div>
                <div style="display: none;" class="f-start-new fab-button f-opened">
                    <i class="f-complete icon ellipsis horizontal grey off"></i>
                    <i title="Select recipients and then click here."
                       class="f-complete icon checkmark grey off"></i>
                    <i class="f-cancel icon close red"><label>Cancel</label></i>
                    <i class="f-invite icon mobile orange"><label>Create Invite</label></i>
                    <i class="f-support icon doctor amber"><label>Talk with support</label></i>
                </div>

                <div class="f-nav-holder">
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
                                <div class="f-active-holder">
                                    <div class="text"></div>
                                </div>
                                <div class="f-main menu">
                                    <div class="ui input search icon">
                                        <i class="icon search"></i>
                                        <input autocapitalize="off" type="text" name="f-start-search"
                                               placeholder="@recipient.tag..."/>
                                    </div>
                                    <div class="f-menu-holder">
                                        <div class="f-contacts scrolling menu visible"></div>
                                        <div class="f-tags scrolling menu visible"></div>
                                    </div>
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

            <div class="f-sizer"></div>

            <section id="f-thread-stack">
                <div class="ui dimmer inverted">
                    <div class="ui loader"></div>
                </div>
            </section>
        </main>
    </body>
</html>
