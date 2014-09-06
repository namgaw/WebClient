angular.module("proton.Routes", [
  "ui.router",
  "proton.Auth"
])

.constant("mailboxIdentifiers", {
  "inbox": 0,
  "drafts": 1,
  "sent": 2,
  "trash": 3,
  "spam": 4,
  "starred": 5
})

.config(function($stateProvider, $urlRouterProvider, $locationProvider, mailboxIdentifiers) {

  var messageViewOptions = {
    url: "/:MessageID",
    controller: "ViewMessageController as messageViewCtrl",
    templateUrl: "templates/views/message.tpl.html",
    resolve: {
      message: function (
        $rootScope,
        $state,
        $stateParams,
        Message,
        messageCache,
        authentication,
        networkActivityTracker
      ) {
        if (authentication.isLoggedIn()) {
          return networkActivityTracker.track(
            messageCache.get($stateParams.MessageID).$promise
          );
        }
      }
    }
  };

  var messageListOptions = function(url, params) {
    var opts = _.extend(params || {}, {
      url: url + "?page&filter&sort",
      views: {
        "content@secured": {
          controller: "MessageListController as messageListCtrl",
          templateUrl: "templates/views/messageList.tpl.html"
        }
      },

      resolve: {
        messages: function (
          $state,
          $stateParams,
          $rootScope,
          authentication,
          Message,
          mailboxIdentifiers,
          networkActivityTracker,
          errorReporter
        ) {
          var mailbox = this.data.mailbox;
          if (authentication.isSecured()) {
            var params = {
              "Location": mailboxIdentifiers[mailbox],
              "Page": $stateParams.page
            };

            // This should replace the starred location when tags are used
            // if (mailbox === 'starred') {
            //   params.Tag = mailbox;
            // }

            if ($stateParams.filter) {
              params.FilterUnread = + ($stateParams.filter === 'unread');
            } else {
              params.FilterUnread = - 2;
            }

            if ($stateParams.sort) {
              var sort = $stateParams.sort;
              var desc = _.string.startsWith(sort, "-");
              if (desc) {
                sort = sort.slice(1);
              }

              params.SortedColumn = _.string.capitalize(sort);
              params.Order = + desc;
            }

            return networkActivityTracker.track(
              errorReporter.resolve(
                "Messages couldn't be queried - please try again later.",
                Message.query(params).$promise,
                []
              )
            );
          } else {
            return [];
          }
        },

        messageCount: function (
          $stateParams,
          Message,
          authentication,
          mailboxIdentifiers,
          errorReporter,
          networkActivityTracker
        ) {
          var mailbox = this.data.mailbox;
          if (authentication.isSecured()) {
            var params = {
              "Location": mailboxIdentifiers[mailbox],
              "Page": $stateParams.page
            };

            // This should replace the starred location when tags are used
            // if (mailbox === 'starred') {
            //   params.Tag = mailbox;
            // }

            return networkActivityTracker.track(
              errorReporter.resolve(
                "Message count couldn't be queried - please try again later.",
                Message.count(params).$promise,
                {count: 0}
              )
            );
          }
        }
      }
    });
    return opts;
  };

  $stateProvider

    // ------------
    // LOGIN ROUTES
    // ------------

    .state("login", {
      url: "/login",
      views: {
        "main@": {
          controller: "LoginController",
          templateUrl: "templates/layout/auth.tpl.html"
        },
        "panel@login": {
          templateUrl: "templates/views/login.tpl.html"
        }
      },
      onEnter: function() {
        window.location.href = "/login";
      }
    })

    .state("login.unlock", {
      url: "/unlock",
      controller: "LoginController",
      views: {
        "panel@login": {
          templateUrl: "templates/views/unlock.tpl.html"
        }
      },
      onEnter: function(authentication, $state) {
        if (!authentication.isLoggedIn()) {
        } else if (!authentication.isLocked()) {
          $state.go("secured.inbox");
        }
      }
    })

    // -------------------------------------------
    // SECURED ROUTES
    // this includes everything after login/unlock
    // -------------------------------------------

    .state("secured", {

      // This is included in every secured.* sub-controller

      abstract: true,
      views: {
        "main@": {
          controller: "SecuredController",
          templateUrl: "templates/layout/secured.tpl.html"
        }
      },
      url: "/secured",

      resolve: {
        user: function (authentication) {
          return authentication.user.$promise;
        }
      },

      onEnter: function(authentication, $state) {
        // This will redirect to a login step if necessary
        authentication.redirectIfNecessary();
      }
    })

    .state("secured.inbox", messageListOptions("/inbox", {
      data: {
        mailbox: "inbox"
      }
    }))

    .state("secured.inbox.relative", {
      url: "/{rel:first|last}",
      controller: function ($scope, $stateParams) {
        $scope.navigateToMessage(null, $stateParams.rel);
      }
    })
    .state("secured.inbox.message", _.clone(messageViewOptions))

    .state("secured.contacts", {
      url: "/contacts",
      views: {
        "content@secured": {
          templateUrl: "templates/views/contacts.tpl.html",
          controller: "ContactsController"
        }
      },
      resolve: {
        contacts: function (Contact) {
          return Contact.query().$promise;
        }
      }
    })

    .state("secured.compose", {
      url: "/compose?to",
      views: {
        "content@secured": {
          templateUrl: "templates/views/compose.tpl.html",
          controller: "ComposeMessageController"
        }
      },
      resolve: {
        message: function(Message) {
          return new Message({
            IsEncrypted: "0"
          });
        }
      }
    })

    .state("secured.reply", {
      url: "/{action:reply|replyall|forward}/:id",
      views: {
        "content@secured": {
          templateUrl: "templates/views/compose.tpl.html",
          controller: "ComposeMessageController"
        }
      },
      resolve: {
        message: function($stateParams, Message, authentication, networkActivityTracker, messageCache) {
          if (authentication.isLoggedIn()) {
            return networkActivityTracker.track(
              authentication.user.$promise.then(function (user) {
                return messageCache.get($stateParams.id).$promise.then(function(targetMessage) {
                  return Message[$stateParams.action](targetMessage);
                })
              })
            );
          }
        }
      }
    })

    .state("secured.settings", {
      url: "/settings",
      views: {
        "content@secured": {
          templateUrl: "templates/views/settings.tpl.html",
          controller: "SettingsController"
        }
      }
    })

    // -------------------------------------------
    //  ADMIN ROUTES
    // -------------------------------------------

    .state("admin", {
      url: "/admin",
      views: {
        "main@": {
          controller: "AdminController",
          templateUrl: "templates/layout/admin.tpl.html"
        },
        "content@admin": {
          templateUrl: "templates/views/admin.tpl.html"
        }
      }
    })

    .state("admin.invite", {
      url: "/invite",
      views: {
        "content@admin": {
          templateUrl: "templates/views/admin.invite.tpl.html",
          controller: "AdminController"
        }
      }
    })

    .state("admin.monitor", {
      url: "/monitor",
      views: {
        "content@admin": {
          templateUrl: "templates/views/admin.monitor.tpl.html",
          controller: "AdminController"
        }
      }
    })

    .state("admin.logs", {
      url: "/logs",
      views: {
        "content@admin": {
          templateUrl: "templates/views/admin.logs.tpl.html",
          controller: "AdminController"
        }
      }
    });

  _.each(mailboxIdentifiers, function(id_, box) {
    if (box === 'inbox') {
      return;
    }

    var stateName = "secured." + box;
    $stateProvider.state(stateName, messageListOptions("/" + box, {
      data: { mailbox: box }
    }));

    $stateProvider.state("secured." + box + ".message", _.clone(messageViewOptions));
  });

  $urlRouterProvider.otherwise(function($injector) {
    var $state = $injector.get("$state");
    var stateName = $injector.get("authentication").state() || "secured.inbox";
    return $state.href(stateName);
  });

  $locationProvider.html5Mode(true);
})

.run(function ($rootScope, $state) {
  $rootScope.go = _.bind($state.go, $state);
});
