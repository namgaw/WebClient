angular.module("proton.Models", [
  "ngResource",
  "proton.Auth"
])

.factory("Contact", function($resource, authentication) {
  return $resource(authentication.baseURL + "/contacts/:ContactID", authentication.params(), {
    query: {
      method: "get",
      isArray: true,
      transformResponse: function (data) {
        return JSON.parse(data).Contacts;
      }
    },
    delete: {
      method: "delete",
      isArray: false,
      params: {"ContactID": "@ContactID"}
    }
  });
})

.factory("Message", function($resource, authentication) {
  return $resource(authentication.baseURL + "/messages/:MessageID", authentication.params(), {
    query: {
      method: "get",
      isArray: true,
      transformResponse: function (data) {
        return JSON.parse(data).Messages;
      }
    },
    delete: {
      method: "delete",
      isArray: false,
      params: {"MessageID": "@MessageID"}
    }
  });
})

.factory("User", function($resource, $injector) {
  var authentication = $injector.get("authentication");
  return $resource(authentication.baseURL + "/user", authentication.params(), {
    get: {
      method: 'get',
      isArray: false,
      transformResponse: function (data) {
        return JSON.parse(data).data;
      }
    }
  });
});
