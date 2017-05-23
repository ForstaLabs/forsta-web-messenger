/*
 * vim: ts=4:sw=4:expandtab
 */
(async function () {
    'use strict';

    $('.ui.dropdown').dropdown();

    $('#toggle-nav').on('click', ev => {
      const nav = $('#forsta-app nav');
      const icon = $('#toggle-nav i.icon');
      if (nav.width() > 100) {
          nav.width(80);
          icon.removeClass('left');
          icon.addClass('right');
      } else {
          nav.width(300);
          icon.removeClass('right');
          icon.addClass('left');
      }
    });

    $('#forsta-app > nav table thead').on('click', ev => {
      const el = $(ev.currentTarget);
      const body = el.next('tbody');
      body.toggle();
    });


    storage.onready(function() {
        if (Whisper.Registration.isDone()) {
            console.info("Loading foundation...");
            initFoundation();
        } else {
            console.warn("No registration found");
            window.location.replace('install');
        }
    });

    await ConversationController.updateInbox();
    var view;
    var $body = $(document.body);
    view = new Forsta.MainView({window: window});
    view.$el.prependTo($body);
    window.openConversation = function(conversation) {
        if (conversation) {
            view.openConversation(null, conversation);
        }
    };
    openConversation(getOpenConversation());
}());
