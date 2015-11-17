angular.module("proton.cache", [])

.service("cache", function(
    $q,
    $rootScope,
    $state,
    $stateParams,
    authentication,
    CONSTANTS,
    Conversation,
    Message,
    cacheCounters,
    networkActivityTracker,
    tools
) {
    var api = {};
    var messagesCached = [];
    var conversationsCached = [];
    var DELETE = 0;
    var CREATE = 1;
    var UPDATE = 2;
    var UPDATE_DRAFT = 2;
    var UPDATE_FLAGS = 3;
    // Parameters shared between api / cache / message view / message list
    var fields = [
        'AddressID',
        'Body',
        'ExpirationTime',
        'HasAttachment',
        'ID',
        'IsEncrypted',
        'IsForwarded',
        'IsRead',
        'IsReplied',
        'IsRepliedAll',
        'LabelIDs',
        'Location',
        'Selected',
        'SenderAddress',
        'SenderName',
        'Size',
        'Starred',
        'Subject',
        'Time',
        'ToList'
    ];

    /**
     * Return a vector to calculate the counters
     * @param {Object} message - message to analyse
     * @param {Boolean} unread - true if unread case
     * @return {Object}
     */
    var vector = function(element, unread) {
        var result = {};
        var condition = true;
        var locations = ['0', '1', '2', '3', '4', '6', '10'].concat(_.map(authentication.user.Labels, function(label) { return label.ID; }) || []);

        if(unread === true) {
            condition = element.IsRead === 0 || element.NumUnread > 0;
        }

        _.each(locations, function(location) {
            result[location] = Number(element.LabelIDs.indexOf(location) !== -1 && condition);
        });

        return result;
    };

    /**
    * Save conversations in conversationsCached and add location in attribute
    * @param {Array} conversations
    */
    var storeConversations = function(conversations) {
        _.each(conversations, function(conversation) {
            var current = _.findWhere(conversationsCached, {ID: conversation.ID});

            if(angular.isDefined(current)) {
                var index = conversationsCached.indexOf(current);

                _.extend(conversationsCached[index], conversation);
            } else {
                insertConversation(conversation);
            }
        });
    };

    /**
     * Save messages in cache
     * @param {Array} messages
     */
    var storeMessages = function(messages) {
        _.each(messages, function(message) {
            var current = _.findWhere(messagesCached, {ID: message.ID});

            message = new Message(message);

            if(angular.isDefined(current)) {
                // Update message
                var index = messagesCached.indexOf(current);

                _.extend(messagesCached[index], message);
            } else {
                // Add message
                messagesCached.push(message);
            }
        });
    };

    /**
     * Insert conversation in conversationsCached
     * @param {Object} conversation
     */
    var insertConversation = function(conversation) {
        conversationsCached.push(conversation);
    };

    var updateConversation = function(conversation) {
        var current = _.findWhere(conversationsCached, {ID: conversation.ID});

        if(angular.isDefined(current)) {
            var index = conversationsCached.indexOf(current);

            _.extend(conversationsCached[index], conversation);
        }
    };

    /**
     * Reorder cache location by reverse time
     * @param {Array} elements - conversation or message
     */
    var order = function(elements) {
        if(angular.isArray(elements)) {
            return _.sortBy(elements, 'Time').reverse();
        } else {
            return [];
        }
    };

    /**
     * Manage the updating to calcultate the total number of messages and unread messages
     * @param {Object} oldList
     * @param {Object} newList
     * @param {String} type
     */
    var manageCounters = function(oldList, newList, type) {
        var oldUnreadVector = vector(oldList, true);
        var newUnreadVector = vector(newList, true);
        var newTotalVector = vector(newList, false);
        var oldTotalVector = vector(oldList, false);

        var locations = ['0', '1', '2', '3', '4', '6', '10'].concat(_.map(authentication.user.Labels, function(label) { return label.ID; }) || []);

        _.each(locations, function(location) {
            var currentUnread = cacheCounters.unread(location);
            var deltaUnread = newUnreadVector[location] - oldUnreadVector[location];
            var currentTotal;
            var deltaTotal;

            if(type === 'message') {
                currentTotal = cacheCounters.total(location);
                deltaTotal = newTotalVector[location] - oldTotalVector[location];
                cacheCounters.update(location, currentTotal + deltaTotal, currentUnread + deltaUnread);
            } else if(type === 'conversation') {
                currentTotal = cacheCounters.conversation(location);
                deltaTotal = newTotalVector[location] - oldTotalVector[location];
                cacheCounters.update(location, undefined, undefined, currentTotal + deltaTotal);
            }
        });
    };

    /**
     * Return location specified in the request
     * @param {Object} request
     * @return {String} location
     */
    var getLocation = function(request) {
        return request.Label;
    };

    /**
     * Call API to get the list of conversations
     * @param {Object} request
     * @return {Promise}
     */
    var queryConversations = function(request) {
        var deferred = $q.defer();
        var location = getLocation(request);
        var context = tools.cacheContext(request);

        Conversation.query(request).then(function(result) {
            var data = result.data;

            if(data.Code === 1000) {
                // Set total value in rootScope
                $rootScope.Total = data.Total;
                // Only for cache context
                if(context === true) {
                    // Set total value in cache
                    cacheCounters.update(location, undefined, undefined, data.Total);
                    // Store conversations
                    storeConversations(data.Conversations);
                }
                // Return conversations
                deferred.resolve(order(data.Conversations)); // We order data also
            } else {
                deferred.reject();
            }
        });

        networkActivityTracker.track(deferred.promise);

        return deferred.promise;
    };

    /**
     * Query api to get messages
     * @param {Object} request
     * @return {Promise}
     */
    var queryMessages = function(request) {
        var deferred = $q.defer();
        var context = tools.cacheContext(request);

        Message.query(request).$promise.then(function(messages) {
            // Only for cache context
            if(context === true) {
                // Store messages
                storeMessages(messages);
            }

            deferred.resolve(order(messages));
        });

        return deferred.promise;
    };

    /**
     * Get conversation from API and store it in the cache
     * @param {String} id
     * @return {Promise}
     */
    var queryConversationMessages = function(id) {
        var deferred = $q.defer();

        Conversation.get(id).then(function(result) {
            var data = result.data;

            if(data.Code === 1000) {
                var messages = [];

                _.each(data.Messages, function(message) {
                    messages.push(new Message(message));
                });

                storeConversations([data.Conversation]);
                storeMessages(messages);
                deferred.resolve(messages);
            } else {
                deferred.reject();
            }
        });

        networkActivityTracker.track(deferred.promise);

        return deferred.promise;
    };

    /**
     * Get conversation from back-end and store it in the cache
     * @param {String} id
     * @return {Promise}
     */
    var getConversation = function(id) {
        var deferred = $q.defer();

        Conversation.get(id).then(function(result) {
            var data = result.data;

            if(data.Code === 1000) {
                var conversation = data.Conversation;
                var messages = data.Messages;

                conversation.preloaded = true;
                storeConversations([conversation]);
                storeMessages(messages);
                deferred.resolve(conversation);
            } else {
                deferred.reject();
            }
        });

        return deferred.promise;
    };

    /**
    * Call the API to get message
    * @param {String} id
    * @return {Promise}
    */
    var getMessage = function(id) {
        var deferred = $q.defer();

        Message.get({ id: id }).$promise.then(function(message) {
            message = new Message(message);
            message.preloaded = true;
            storeMessages([message]);
            deferred.resolve(message);
        });

        return deferred.promise;
    };

    /**
     * Return message list
     * @param {Object} request
     * @return {Promise}
     */
    api.queryMessages = function(request) {
        var deferred = $q.defer();
        var location = getLocation(request);
        var context = tools.cacheContext(request);
        var callApi = function() {
            deferred.resolve(queryMessages(request));
        };

        if(context) {
            var page = request.Page || 0;
            var start = page * CONSTANTS.MESSAGES_PER_PAGE;
            var end = start + CONSTANTS.MESSAGES_PER_PAGE;
            var total;
            var number;
            var mailbox = tools.currentMailbox();
            var messages = _.filter(messagesCached, function(message) {
                return angular.isDefined(message.LabelIDs) && message.LabelIDs.indexOf(location.toString()) !== -1;
            });

            messages = order(messages);

            console.info('Number of messages in the cache', messages.length);

            switch(mailbox) {
                case 'label':
                    total = cacheCounters.total($stateParams.label);
                    break;
                default:
                    total = cacheCounters.total(CONSTANTS.MAILBOX_IDENTIFIERS[mailbox]);
                    break;
            }

            console.info('Number return by API', total);

            if(angular.isDefined(total)) {
                if((total % CONSTANTS.MESSAGES_PER_PAGE) === 0) {
                    number = CONSTANTS.MESSAGES_PER_PAGE;
                } else {
                    if((Math.ceil(total / CONSTANTS.MESSAGES_PER_PAGE) - 1) === page) {
                        number = total % CONSTANTS.MESSAGES_PER_PAGE;
                    } else {
                        number = CONSTANTS.MESSAGES_PER_PAGE;
                    }
                }

                messages = messages.slice(start, end);

                // Supposed total equal to the total cache?
                if(messages.length === number) {
                    deferred.resolve(messages);
                } else {
                    callApi();
                }
            } else {
                callApi();
            }
        } else {
            callApi();
        }

        return deferred.promise;
    };

    /**
     * Return conversation list with request specified in cache or call api
     * @param {Object} request
     * @return {Promise}
     */
    api.queryConversations = function(request) {
        var deferred = $q.defer();
        var location = getLocation(request);
        var context = tools.cacheContext(request);
        var callApi = function() {
            // Need data from the server
            deferred.resolve(queryConversations(request));
        };

        // In cache context?
        if(context) {
            var page = request.Page || 0;
            var start = page * CONSTANTS.MESSAGES_PER_PAGE;
            var end = start + CONSTANTS.MESSAGES_PER_PAGE;
            var total;
            var number;
            var mailbox = tools.currentMailbox();
            var conversations = _.filter(conversationsCached, function(conversation) {
                return angular.isDefined(conversation.LabelIDs) && conversation.LabelIDs.indexOf(location.toString()) !== -1;
            });

            conversations = order(conversations);

            console.info('Number of conversations cached for "' + location + '":', conversations.length);

            switch(mailbox) {
                case 'label':
                    total = cacheCounters.conversation($stateParams.label);
                    break;
                default:
                    total = cacheCounters.conversation(CONSTANTS.MAILBOX_IDENTIFIERS[mailbox]);
                    break;
            }

            console.info('Value returned by the BE:', total);

            if(angular.isDefined(total)) {
                if((total % CONSTANTS.MESSAGES_PER_PAGE) === 0) {
                    number = CONSTANTS.MESSAGES_PER_PAGE;
                } else {
                    if((Math.ceil(total / CONSTANTS.MESSAGES_PER_PAGE) - 1) === page) {
                        number = total % CONSTANTS.MESSAGES_PER_PAGE;
                    } else {
                        number = CONSTANTS.MESSAGES_PER_PAGE;
                    }
                }

                conversations = conversations.slice(start, end);

                // Supposed total equal to the total cache?
                if(conversations.length === number) {
                    console.info('Correct number in the cache');
                    deferred.resolve(conversations);
                } else {
                    console.info('Not the correct number in the cache'); // TODO remove it
                    callApi();
                }
            } else {
                callApi();
            }
        } else {
            callApi();
        }

        return deferred.promise;
    };

    /**
     * Try to find the result in the cache
     * @param {String} conversationId
     */
    api.queryConversationMessages = function(conversationId) {
        var deferred = $q.defer();
        var conversation = _.findWhere(conversationsCached, {ID: conversationId});
        var callApi = function() {
            deferred.resolve(queryConversationMessages(conversationId));
        };

        if(angular.isDefined(conversation)) {
            var messages = _.where(messagesCached, {ConversationID: conversationId});

            if(conversation.NumMessages === messages.length) {
                deferred.resolve(messages);
            } else {
                callApi();
            }
        } else {
            callApi();
        }

        return deferred.promise;
    };

    /**
     * Return a copy of messages cached for a specific ConversationID
     * @param {String} conversationId
     */
    api.queryMessagesCached = function(conversationId) {
        return angular.copy(_.where(messagesCached, {ConversationID: conversationId}));
    };

    /**
     * @param {String} conversationId
     * @return {Promise}
     */
    api.getConversation = function(conversationId) {
        var deferred = $q.defer();
        var conversation = _.findWhere(conversationsCached, {ID: conversationId});

        if(angular.isDefined(conversation)) {
            deferred.resolve(conversation);
        } else {
            deferred.resolve(getConversation(conversationId));
        }

        return deferred.promise;
    };

    /**
     * Accessible method to preload a specific conversation
     */
    api.preloadConversation = function(id) {
        return getConversation(id);
    };

    /**
     * Preload message and store it
     */
    api.preloadMessage = function(id) {
        return getMessage(id);
    };

    /**
    * Return the message specified by the id from the cache or the back-end
    * @param {String} ID - Message ID
    * @return {Promise}
    */
    api.getMessage = function(ID) {
        var deferred = $q.defer();
        var message = _.findWhere(messagesCached, {ID: ID});

        if(angular.isDefined(message) && angular.isDefined(message.Body)) {
            deferred.resolve(message);
        } else {
            deferred.resolve(getMessage(ID));
        }

        return deferred.promise;
    };

    /**
    * Delete message in the cache if the message is present
    * @param {Object} event
    */
    api.deleteMessage = function(event) {
        var deferred = $q.defer();

        // Delete message
        messagesCached = _.filter(messagesCached, function(message) {
            return message.ID !== event.ID;
        });

        // Delete conversation

        deferred.resolve();

        return deferred.promise;
    };

    /**
     * Delete conversation
     * @param {Object} event
     * @return {Promise}
     */
    api.deleteConversation = function(event) {
        var deferred = $q.defer();

        // Delete messages
        messagesCached = _.filter(messagesCached, function(message) {
            return message.ConversationID !== event.ID;
        });

        // Delete conversation
        conversationsCached = _.filter(conversationsCached, function(conversation) {
            return conversation.ID !== event.ID;
        });

        deferred.resolve();

        return deferred.promise;
    };

    /**
    * Remove conversations from cache location
    * @param {String} location
    */
    api.empty = function(location) {
        var toDelete = [];

        _.each(conversationsCached, function(conversation, index) {
            if(conversation.LabelIDs.indexOf(location + '')) {
                messagesCached = _.filter(messagesCached, function(message) {
                    return message.ConversationID !== conversation.ID;
                });

                toDelete.push(index);
            }
        });

        _.each(toDelete, function(index) {
            delete conversationsCached[index];
        });

        api.callRefresh();
    };

    /**
    * Preload conversations for inbox (first 2 pages) and sent (first page)
    * @return {Promise}
    */
    api.preloadInboxAndSent = function() {
        var mailbox = tools.currentMailbox();
        var deferred = $q.defer();
        var requestInbox;
        var requestSent;

        if(mailbox === 'inbox') {
            requestInbox = {Label: CONSTANTS.MAILBOX_IDENTIFIERS.inbox, Page: 1};
            requestSent = {Label: CONSTANTS.MAILBOX_IDENTIFIERS.sent, Page: 0};
        } else if(mailbox === 'sent') {
            requestInbox = {Label: CONSTANTS.MAILBOX_IDENTIFIERS.inbox, Page: 0, PageSize: 100};
            requestSent = {};
        } else {
            requestInbox = {Label: CONSTANTS.MAILBOX_IDENTIFIERS.inbox, Page: 0, PageSize: 100};
            requestSent = {Label: CONSTANTS.MAILBOX_IDENTIFIERS.sent, Page: 0};
        }

        $q.all({
            inbox: queryConversations(requestInbox),
            sent: queryMessages(requestSent)
        }).then(function() {
            deferred.resolve();
        });

        return deferred.promise;
    };

    /**
    * Add a new message in the cache
    * @param {Object} event
    * @return {Promise}
    */
    api.createMessage = function(event) {
        var deferred = $q.defer();
        var messages = [event.Message];

        storeMessages(messages);

        deferred.resolve();

        return deferred.promise;
    };

    /**
     * Add a new conversation in the cache
     * @param {Object} event
     * @return {Promise}
     */
    api.createConversation = function(event) {
        var deferred = $q.defer();
        var current = _.findWhere(conversationsCached, {ID: event.ID});

        if(angular.isUndefined(current)) {
            var mailbox = tools.currentMailbox();
            var request = {Conversation: event.ID};

            switch (mailbox) {
                case 'label':
                    request.Label = $stateParams.label;
                    break;
                default:
                    request.Label = CONSTANTS.MAILBOX_IDENTIFIERS[mailbox];
                    break;
            }

            Conversation.query(request).then(function(result) {
                var data = result.data;

                if(data.Code === 1000) {
                    // Set total value in rootScope
                    $rootScope.Total = data.Total;

                    // Set total value in cache
                    cacheCounters.update(location, undefined, undefined, data.Total);

                    // Store conversations
                    storeConversations(data.Conversations);

                    deferred.resolve();
                } else {
                    deferred.reject();
                }
            });
        } else {
            updateConversation(event.Conversation);
            deferred.resolve();
        }

        return deferred.promise;
    };

    /**
    * Update only a draft message
    * @param {Object} event
    * @return {Promise}
    */
    api.updateDraft = function(event) {
        var deferred = $q.defer();
        var messages = [event.Message];

        storeMessages(messages);

        deferred.resolve();

        return deferred.promise;
    };

    /**
    * Update message attached to the id specified
    * @param {Object} event
    * @return {Promise}
    */
    api.updateFlagMessage = function(event) {
        var deferred = $q.defer();
        var current = _.findWhere(messagesCached, {ID: event.ID});

        // Present in the current cache?
        if(angular.isDefined(current)) {
            var index = messagesCached.indexOf(current);
            var message = new Message();

            _.extend(message, current, event.Message);

            if(JSON.stringify(message) === JSON.stringify(current)) {
                deferred.resolve();
            } else {
                // Manage labels
                if(angular.isDefined(event.Message.LabelIDsAdded)) {
                    message.LabelIDs = _.uniq(message.LabelIDs.concat(event.Message.LabelIDsAdded));
                    delete message.LabelIDsAdded;
                }

                if(angular.isDefined(event.Message.LabelIDsRemoved)) {
                    message.LabelIDs = _.difference(message.LabelIDs, event.Message.LabelIDsRemoved);
                    delete message.LabelIDsRemoved;
                }

                messagesCached[index] = message;

                if($rootScope.dontUpdateNextCounter === true) {
                    $rootScope.dontUpdateNextCounter = false;
                } else {
                    manageCounters(current, messagesCached[index], 'message');
                }

                deferred.resolve();
           }
        } else {
            // Do nothing
            deferred.resolve();
        }

        return deferred.promise;
    };

    /**
     * Update conversation cached
     * @param {Object} event
     * @return {Promise}
     */
     api.updateFlagConversation = function(event) {
         var deferred = $q.defer();
         var current = _.findWhere(conversationsCached, {ID: event.ID});

         if(angular.isDefined(current)) {
             var conversation = {};
             var index = conversationsCached.indexOf(current);

             _.extend(conversation, current, event.Conversation);

             // Manage labels
             if(angular.isDefined(event.Conversation.LabelIDsAdded)) {
                 conversation.LabelIDs = _.uniq(conversation.LabelIDs.concat(event.Conversation.LabelIDsAdded));
                 delete conversation.LabelIDsAdded;
             }

             if(angular.isDefined(event.Conversation.LabelIDsRemoved)) {
                 conversation.LabelIDs = _.difference(conversation.LabelIDs, event.Conversation.LabelIDsRemoved);
                 delete conversation.LabelIDsRemoved;
             }

             // Update conversation cached
             conversationsCached[index] = conversation;

             if($rootScope.dontUpdateNextCounter === true) {
                 $rootScope.dontUpdateNextCounter = false;
             } else {
                 manageCounters(current, conversationsCached[index], 'conversation');
             }

             deferred.resolve();
         } else if(angular.isDefined(event.Conversation)) {
            // Create a new conversation in the cache
            api.createConversation(event).then(function() {
                deferred.resolve();
            });
         }

         return deferred.promise;
     };

    /**
    * Manage the cache when a new event comes
    * @param {Array} events
    */
    api.events = function(events, type) {
        var promises = [];

        console.log(events, type);

        _.each(events, function(event) {
            if(type === 'message') {
                switch (event.Action) {
                    case DELETE:
                        promises.push(api.deleteMessage(event));
                        break;
                    case CREATE:
                        promises.push(api.createMessage(event));
                        break;
                    case UPDATE_DRAFT:
                        promises.push(api.updateDraft(event));
                        break;
                    case UPDATE_FLAGS:
                        promises.push(api.updateFlagMessage(event));
                        break;
                    default:
                        break;
                }
            } else if(type === 'conversation') {
                switch (event.Action) {
                    case DELETE:
                        promises.push(api.deleteConversation(event));
                        break;
                    case CREATE:
                        promises.push(api.createConversation(event));
                        break;
                    case UPDATE_DRAFT:
                        promises.push(api.updateFlagConversation(event));
                        break;
                    case UPDATE_FLAGS:
                        promises.push(api.updateFlagConversation(event));
                        break;
                    default:
                        break;
                }
            }
        });

        $q.all(promises).then(function() {
            api.callRefresh();
        });
    };

    /**
     * Ask to the message list controller to refresh the messages
     * First with the cache
     * Second with the query call
     */
    api.callRefresh = function() {
        $rootScope.$broadcast('refreshConversations');
        $rootScope.$broadcast('refreshCounters');
        $rootScope.$broadcast('updatePageName');

        if(angular.isDefined($stateParams.id)) {
            $rootScope.$broadcast('refreshConversation');
            $rootScope.$broadcast('refreshMessage');
        }
    };

    /**
     * Clear cache and hash
     */
    api.clear = function() {
        conversationsCached = [];
        messagesCached = [];
    };

    /**
     * Reset cache and hash then preload inbox and sent
     */
    api.reset = function() {
        api.clear();
        api.preloadInboxAndSent();
    };

    /**
     * Manage expiration time for messages in the cache
     */
    api.expiration = function() {
        var now = Date.now() / 1000;
        var removed = 0;

        messagesCached = _.filter(messagesCached, function(message) {
            var expTime = message.ExpirationTime;
            var response = (expTime !== 0 && expTime < now) ? false : true;

            if (!response) {
                removed++;
            }

            return response;
        });

        if (removed > 0) {
            api.callRefresh();
        }
    };

    /**
     * Return previous ID of message specified
     * @param {Object} conversation
     * @param {String} type - 'next' or 'previous'
     * @return {Promise}
     */
    api.more = function(conversation, type) {
        var deferred = $q.defer();
        var location = tools.currentLocation();
        var request = {PageSize: 1, Label: location};

        if(type === 'previous') {
            request.End = conversation.Time;
        } else {
            request.Begin = conversation.Time;
        }

        queryConversations(request).then(function(conversation) {
            console.log(conversation);
            deferred.resolve();
            // if(angular.isArray(conversation) && conversation.length > 0) {
            //     if(type === 'next') {
            //         var first = _.first(conversation);
            //
            //         deferred.resolve(first.ID);
            //     } else if(type === 'previous') {
            //         var last = _.last(conversation);
            //
            //         deferred.resolve(last.ID);
            //     }
            // } else {
            //     deferred.reject();
            // }
        });

        return deferred.promise;
    };

    return api;
})

.service('cacheCounters', function(Message, CONSTANTS, Conversation, $q, $rootScope, authentication) {
    var api = {};
    var counters = {};
    // {
    //     location: {
    //         total: value,
    //         unread: value
    //     }
    // }
    var exist = function(location) {
        if(angular.isUndefined(counters[location])) {
            counters[location] = {
                total: 0,
                unread: 0,
                conversation: 0
            };
        }
    };

    /**
    * Query unread and total
    * @return {Promise}
    */
    api.query = function() {
        var deferred = $q.defer();

        $q.all({
            message: Message.count().$promise,
            conversation: Conversation.count()
        }).then(function(result) {
            _.each(result.message.Counts, function(counter) {
                exist(counter.LabelID);
                counters[counter.LabelID].total = counter.Total;
                counters[counter.LabelID].unread = counter.Unread;
            });

            _.each(result.conversation.data.Counts, function(counter) {
                exist(counter.LabelID);
                counters[counter.LabelID].conversation = counter.Total;
            });

            deferred.resolve();
        },function(error) {
            deferred.reject(error);
        });

        return deferred.promise;
    };

    /**
    * Update the total / unread for a specific location
    * @param {String} location
    * @param {Integer} total
    * @param {Integer} unread
    * @param {Integer} conversation
    */
    api.update = function(location, total, unread, conversation) {
        exist(location);

        if(angular.isDefined(total)) {
            counters[location].total = total;
        }

        if(angular.isDefined(unread)) {
            counters[location].unread = unread;
        }

        if(angular.isDefined(conversation)) {
            counters[location].conversation = conversation;
        }

        $rootScope.$broadcast('updatePageName');
    };

    /**
    * Get the total of messages for a specific location
    * @param {String} location
    */
    api.total = function(location) {
        return counters[location] && counters[location].total;
    };

    /**
    * Get the number of unread messages for the specific location
    * @param {String} location
    */
    api.unread = function(location) {
        return counters[location] && counters[location].unread;
    };

    /**
     * Get the number of conversations for a specific location
     */
    api.conversation = function(location) {
        return counters[location] && counters[location].conversation;
    };

    /**
    * Clear location counters
    * @param {String} location
    */
    api.empty = function(location) {
        if(angular.isDefined(counters[location])) {
            counters[location] = {
                total: 0,
                unread: 0
            };
        }
    };

    return api;
})

.factory('preloadConversation', function(
    $interval,
    cache
) {
    var api = {};
    var queue = [];
    var interval = 5000; // 15 seconds // TODO set 15 seconds for the release

    /**
    * Set current conversations viewed
    * @param {Array} conversations
    */
    api.set = function(conversations) {
        api.reset();
        api.add(conversations); // Add unread conversations to the queue
    };

    /**
    * Reset current queue
    */
    api.reset = function() {
        queue = [];
    };

    /**
    * Add unread conversations to the queue
    * @param {Array} conversations
    */
    api.add = function(conversations) {
        // Add only unread conversations to the queue
        // Filter by conversation where the Body is undefined
        queue = _.union(queue, _.where(conversations, { preloaded: undefined }));
    };

    /**
    * Preload conversations present in the queue
    */
    api.preload = function() {
        // Get the first conversation in the queue
        var element  = _.first(queue);

        if(angular.isDefined(element)) {
            var promise;

            if(angular.isDefined(element.ConversationID)) {
                promise = cache.preloadMessage(element.ID);
            } else {
                // Preload the first conversation
                promise = cache.preloadConversation(element.ID);
            }

            promise.then(function() {
                // Remove the first element in the queue
                queue = _.without(queue, element);
            });
        }
    };

    /**
    * Loop around conversations present in the queue to preload the Body
    */
    api.loop = function() {
        var looping = $interval(function() {
            api.preload();
        }, interval);
    };

    // NOTE Andy said: "We preload nothing, that's too expensive for the back-end"
    // api.loop(); // Start looping

    return api;
})

.factory('expiration', function($interval, cache) {
    var api = {};
    var interval = 5000;
    var need = false;
    var elements = [];

    /**
     * Delete message if expired
     */
    var process = function() {
        if(need === true) {
            if(elements.length > 0) {
                var messages = [];
                var type = (angular.isDefined(_.first(elements).ConversationID))?'message':'conversation';

                // Set messages
                if(type === 'message') {
                    messages = elements;
                } else if(type === 'conversation') {
                    messages = cache.queryConversationMessages(_.first(elements).ConversationID);
                }

                // Get elements expired
                var elementsExpired = _.filter(messages, function(element) {
                    return element.ExpirationTime < moment().unix();
                });

                if(elementsExpired.length > 0) {
                    // Generate an event to delete message expired in the cache
                    var messageEvent = [];

                    _.each(elementsExpired, function(message) {
                        messageEvent.push({Action: 0, ID: message.ID});
                    });

                    cache.events(messageEvent, 'message');
                }
            }

            need = false;
        }
    };

    /**
     * Start to loop
     */
    var start = function() {
        $interval(function() {
            process();
        }, interval);
    };

    /**
     * Assign new elements
     */
    api.check = function(elements) {
        elements = elements;
        need = true;
    };

    // Start looping around conversations / messages
    start();

    return api;
});
