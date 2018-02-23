// vim: ts=4:sw=4:expandtab
/* global */

(function (root, factory) {
    // Browser globals (root is window)
    root.returnExports = factory(root.Backbone, root._);
}(this, function (Backbone, _) {

    if (typeof indexedDB === "undefined") {
        return;
    }

    class NotFound extends ReferenceError {
        constructor(key) {
            super('Not Found');
            this.key = key;
        }
    }

    // Driver object
    // That's the interesting part.
    // There is a driver for each schema provided. The schema is a te combination of name (for the database), a version as well as migrations to reach that
    // version of the database.
    function Driver(schema, ready, onerror) {
        this.schema         = schema;
        this.ready          = ready;
        this.error          = null;
        this.transactions   = []; // Used to list all transactions and keep track of active ones.
        this.db             = null;
        this.onerror        = onerror;
        if (!this.schema.id) {
            throw new Error("No Database ID");
        }
        var lastMigrationPathVersion = _.last(this.schema.migrations).version;
        console.info("Opening database " + this.schema.id + " in version #" + lastMigrationPathVersion);
        this.dbRequest = indexedDB.open(this.schema.id, lastMigrationPathVersion); //schema version need to be an unsigned long

        this.launchMigrationPath = function(dbVersion) {
            var transaction = this.dbRequest.transaction;
            var clonedMigrations = _.clone(schema.migrations);
            this.migrate(transaction, clonedMigrations, dbVersion, {
                error: _.bind(function(event) {
                    this.error = "Database not up to date. " + dbVersion + " expected was " + lastMigrationPathVersion;
                }, this)
            });
        };

        this.dbRequest.onblocked = ev => {
            this.error = "Connection to the database blocked";
            console.error(this.error, ev);
            const globalEvent = new Event('dbblocked');
            globalEvent.originalEvent = ev;
            self.dispatchEvent(globalEvent);
            this.onerror();
        };

        this.dbRequest.onsuccess = ev => {
            const db = this.db = ev.target.result;
            db.onversionchange = ev => {
                console.warn("Database version change requested somewhere: Closing our connection!");
                try {
                    db.close();
                } finally {
                    const globalEvent = new Event('dbversionchange');
                    globalEvent.db = db;
                    globalEvent.originalEvent = ev;
                    self.dispatchEvent(globalEvent);
                }
            };
            var currentIntDBVersion = (parseInt(this.db.version) ||  0); // we need convert beacuse chrome store in integer and ie10 DP4+ in int;
            var lastMigrationInt = (parseInt(lastMigrationPathVersion) || 0);  // And make sure we compare numbers with numbers.

            if (currentIntDBVersion === lastMigrationInt) { //if support new event onupgradeneeded will trigger the ready function
                // No migration to perform!
                this.ready();
            } else if (currentIntDBVersion < lastMigrationInt ) {
                // We need to migrate up to the current migration defined in the database
                this.launchMigrationPath(currentIntDBVersion);
            } else {
                // Looks like the IndexedDB is at a higher version than the current driver schema.
                this.error = "Database version is greater than current code " + currentIntDBVersion + " expected was " + lastMigrationInt;
            }
        };

        this.dbRequest.onerror = ev => {
            this.error = "Could not connect to the database";
            console.error(this.error, ev);
            this.onerror();
        };

        this.dbRequest.onabort = ev => {
            this.error = "Connection to the database aborted";
            console.error(this.error, ev);
            this.onerror();
        };

        this.dbRequest.onupgradeneeded = ev => {
            this.db = ev.target.result;
            var newVersion = ev.newVersion;
            var oldVersion = ev.oldVersion;
            // Fix Safari 8 and iOS 8 bug
            // at the first connection oldVersion is equal to 9223372036854776000
            // but the real value is 0
            if (oldVersion > 99999999999) {
                oldVersion = 0;
            }
            console.warn("onupgradeneeded = " + oldVersion + " => " + newVersion);
            this.launchMigrationPath(oldVersion);
        };
    }

    // Driver Prototype
    Driver.prototype = {

        // Tracks transactions. Mostly for debugging purposes. TO-IMPROVE
        _track_transaction: function(transaction) {
            this.transactions.push(transaction);
            var removeIt = _.bind(function() {
                var idx = this.transactions.indexOf(transaction);
                if (idx !== -1) {this.transactions.splice(idx); }
            }, this);
            transaction.oncomplete = removeIt;
            transaction.onabort = removeIt;
            transaction.onerror = removeIt;
        },

        // Performs all the migrations to reach the right version of the database.
        migrate: function(transaction, migrations, version, options) {
            transaction.onerror = options.error;
            transaction.onabort = options.error;

            console.info("DB migrate begin version from #" + version);
            var that = this;
            var migration = migrations.shift();
            if (migration) {
                if (!version || version < migration.version) {
                    // We need to apply this migration-
                    if (typeof migration.before == "undefined") {
                        migration.before = function (next) {
                            next();
                        };
                    }
                    if (typeof migration.after == "undefined") {
                        migration.after = function (next) {
                            next();
                        };
                    }
                    migration.before(function () {
                        console.warn("DB migrating to:", migration.version);
                        migration.migrate(transaction, function () {
                            migration.after(function () {
                                console.info("DB migrated:", migration.version);
                                if (migrations.length) {
                                    that.migrate(transaction, migrations, version, options);
                                }
                            });
                        });
                    });
                } else {
                    // No need to apply this migration
                    that.migrate(transaction, migrations, version, options);
                }
            }
        },

        // This is the main method, called by the ExecutionQueue when the driver is ready (database open and migration performed)
        execute: function(storeName, method, object, options) {
            switch (method) {
                case "create":
                    this.create(storeName, object, options);
                    break;
                case "read":
                    if (object.id || object.cid) {
                        this.read(storeName, object, options); // It's a model
                    } else {
                        this.query(storeName, object, options); // It's a collection
                    }
                    break;
                case "update":
                    this.update(storeName, object, options); // We may want to check that this is not a collection. TOFIX
                    break;
                case "delete":
                    if (object.id || object.cid) {
                        this['delete'](storeName, object, options);
                    } else {
                        this.clear(storeName, object, options);
                    }
                    break;
                default:
                    throw new Error(`Unexpected method: ${method}`);
            }
        },

        // Writes the json to the storeName in db. It is a create operations, which means it will fail if the key already exists
        // options are just success and error callbacks.
        create: function(storeName, object, options) {
            var writeTransaction = this.db.transaction([storeName], 'readwrite');
            //this._track_transaction(writeTransaction);
            var store = writeTransaction.objectStore(storeName);
            var json = object.toJSON();
            var idAttribute = _.result(object, 'idAttribute');
            if (json[idAttribute] === undefined && !store.autoIncrement) json[idAttribute] = F.util.uuid4();

            writeTransaction.onerror = function(e) {
                options.error(e);
            };
            writeTransaction.oncomplete = function(e) {
                options.success(json);
            };
            if (!store.keyPath)
                store.add(json, json[idAttribute]);
            else
                store.add(json);
        },

        // Writes the json to the storeName in db. It is an update operation, which means it will overwrite the value if the key already exist
        // options are just success and error callbacks.
        update: function (storeName, object, options) {
            var writeTransaction = this.db.transaction([storeName], 'readwrite');
            //this._track_transaction(writeTransaction);
            var store = writeTransaction.objectStore(storeName);
            var json = object.toJSON();
            var idAttribute = _.result(object, 'idAttribute');
            var writeRequest;

            if (!json[idAttribute]) json[idAttribute] = F.util.uuid4();

            if (!store.keyPath)
              writeRequest = store.put(json, json[idAttribute]);
            else
              writeRequest = store.put(json);

            writeRequest.onerror = function (e) {
                options.error(e);
            };
            writeTransaction.oncomplete = function (e) {
                options.success(json);
            };
        },

        // Reads from storeName in db with json.id if it's there of with any json.xxxx as long as xxx is an index in storeName
        read: function (storeName, object, options) {
            var readTransaction = this.db.transaction([storeName], "readonly");
            this._track_transaction(readTransaction);

            var store = readTransaction.objectStore(storeName);
            var json = object.toJSON();
            var idAttribute = _.result(object, 'idAttribute');

            var getRequest = null;
            let keyIdent;
            if (json[idAttribute]) {
                keyIdent = json[idAttribute];
                getRequest = store.get(keyIdent);
            } else if (options.index) {
                var index = store.index(options.index.name);
                keyIdent = options.index.value;
                getRequest = index.get(keyIdent);
            } else {
                // We need to find which index we have
                var cardinality = 0; // try to fit the index with most matches
                _.each(store.indexNames, function (key) {
                    var index = store.index(key);
                    if(typeof index.keyPath === 'string' && 1 > cardinality) {
                        // simple index
                        if (json[index.keyPath] !== undefined) {
                            keyIdent = json[index.keyPath];
                            getRequest = index.get(keyIdent);
                            cardinality = 1;
                        }
                    } else if(typeof index.keyPath === 'object' && index.keyPath.length > cardinality) {
                        // compound index
                        var valid = true;
                        var keyValue = _.map(index.keyPath, function(keyPart) {
                            valid = valid && json[keyPart] !== undefined;
                            return json[keyPart];
                        });
                        if(valid) {
                            keyIdent = keyValue;
                            getRequest = index.get(keyIdent);
                            cardinality = index.keyPath.length;
                        }
                    }
                });
            }
            if (getRequest) {
                getRequest.onsuccess = function (event) {
                    if (event.target.result) {
                        options.success(event.target.result);
                    } else if (options.not_found_error === false) {
                        options.success(undefined);
                    } else {
                        options.error(new NotFound(keyIdent));
                    }
                };
                getRequest.onerror = function () {
                    if (options.not_found_error === false) {
                        options.success(undefined);
                    } else {
                        options.error(new NotFound(keyIdent));
                    }
                };
            } else if (options.not_found_error === false) {
                options.success(undefined);
            } else {
                options.error(new NotFound(keyIdent));
            }
        },

        // Deletes the json.id key and value in storeName from db.
        delete: function (storeName, object, options) {
            var deleteTransaction = this.db.transaction([storeName], 'readwrite');
            //this._track_transaction(deleteTransaction);

            var store = deleteTransaction.objectStore(storeName);
            var json = object.toJSON();
            var idAttribute = store.keyPath || _.result(object, 'idAttribute');

            var deleteRequest = store['delete'](json[idAttribute]);

            deleteTransaction.oncomplete = function (event) {
                options.success(null);
            };
            deleteRequest.onerror = function (event) {
                options.error(new Error("Not Deleted"));
            };
        },

        // Clears all records for storeName from db.
        clear: function (storeName, object, options) {
            var deleteTransaction = this.db.transaction([storeName], "readwrite");
            //this._track_transaction(deleteTransaction);

            var store = deleteTransaction.objectStore(storeName);

            var deleteRequest = store.clear();
            deleteRequest.onsuccess = function (event) {
                options.success(null);
            };
            deleteRequest.onerror = function (event) {
                options.error(new Error("Not Cleared"));
            };
        },

        // Performs a query on storeName in db.
        // options may include :
        // - conditions : value of an index, or range for an index
        // - range : range for the primary key
        // - limit : max number of elements to be yielded
        // - offset : skipped items.
        query: function (storeName, collection, options) {
            var elements = [];
            var skipped = 0, processed = 0;
            var queryTransaction = this.db.transaction([storeName], "readonly");
            //this._track_transaction(queryTransaction);

            var idAttribute = _.result(collection.model.prototype, 'idAttribute');
            var readCursor = null;
            var store = queryTransaction.objectStore(storeName);
            var index = null,
                lower = null,
                upper = null,
                bounds = null;

            if (options.conditions) {
                // We have a condition, we need to use it for the cursor
                _.each(store.indexNames, function(key) {
                    if (!readCursor) {
                        index = store.index(key);
                        if (options.conditions[index.keyPath] instanceof Array) {
                            lower = options.conditions[index.keyPath][0] > options.conditions[index.keyPath][1] ? options.conditions[index.keyPath][1] : options.conditions[index.keyPath][0];
                            upper = options.conditions[index.keyPath][0] > options.conditions[index.keyPath][1] ? options.conditions[index.keyPath][0] : options.conditions[index.keyPath][1];
                            bounds = IDBKeyRange.bound(lower, upper, true, true);

                            if (options.conditions[index.keyPath][0] > options.conditions[index.keyPath][1]) {
                                // Looks like we want the DESC order
                                readCursor = index.openCursor(bounds, IDBCursor.PREV || "prev");
                            } else {
                                // We want ASC order
                                readCursor = index.openCursor(bounds, IDBCursor.NEXT || "next");
                            }
                        } else if (typeof options.conditions[index.keyPath] === 'object' && ('$gt' in options.conditions[index.keyPath] || '$gte' in options.conditions[index.keyPath])) {
                            if('$gt' in options.conditions[index.keyPath])
                                bounds = IDBKeyRange.lowerBound(options.conditions[index.keyPath]['$gt'], true);
                            else
                                bounds = IDBKeyRange.lowerBound(options.conditions[index.keyPath]['$gte']);
                            readCursor = index.openCursor(bounds, IDBCursor.NEXT || "next");
                        } else if (typeof options.conditions[index.keyPath] === 'object' && ('$lt' in options.conditions[index.keyPath] || '$lte' in options.conditions[index.keyPath])) {
                            if('$lt' in options.conditions[index.keyPath])
                                bounds = IDBKeyRange.upperBound(options.conditions[index.keyPath]['$lt'], true);
                            else
                                bounds = IDBKeyRange.upperBound(options.conditions[index.keyPath]['$lte']);
                            readCursor = index.openCursor(bounds, IDBCursor.NEXT || "next");
                        } else if (options.conditions[index.keyPath] != undefined) {
                            bounds = IDBKeyRange.only(options.conditions[index.keyPath]);
                            readCursor = index.openCursor(bounds);
                        }
                    }
                });
            } else if (options.index) {
                index = store.index(options.index.name);
                const excludeLower = !!options.index.excludeLower;
                const excludeUpper = !!options.index.excludeUpper;
                if (index) {
                    if (options.index.lower && options.index.upper) {
                        bounds = IDBKeyRange.bound(options.index.lower, options.index.upper, excludeLower, excludeUpper);
                    } else if (options.index.lower) {
                        bounds = IDBKeyRange.lowerBound(options.index.lower, excludeLower);
                    } else if (options.index.upper) {
                        bounds = IDBKeyRange.upperBound(options.index.upper, excludeUpper);
                    } else if (options.index.only) {
                        bounds = IDBKeyRange.only(options.index.only);
                    }

                    if (typeof options.index.order === 'string' && options.index.order.toLowerCase() === 'desc') {
                        readCursor = index.openCursor(bounds, IDBCursor.PREV || "prev");
                    } else {
                        readCursor = index.openCursor(bounds, IDBCursor.NEXT || "next");
                    }
                }
            } else {
                // No conditions, use the index
                if (options.range) {
                    lower = options.range[0] > options.range[1] ? options.range[1] : options.range[0];
                    upper = options.range[0] > options.range[1] ? options.range[0] : options.range[1];
                    bounds = IDBKeyRange.bound(lower, upper);
                    if (options.range[0] > options.range[1]) {
                        readCursor = store.openCursor(bounds, IDBCursor.PREV || "prev");
                    } else {
                        readCursor = store.openCursor(bounds, IDBCursor.NEXT || "next");
                    }
                } else if (options.sort && options.sort.index) {
                    if (options.sort.order === -1) {
                        readCursor = store.index(options.sort.index).openCursor(null, IDBCursor.PREV || "prev");
                    } else {
                        readCursor = store.index(options.sort.index).openCursor(null, IDBCursor.NEXT || "next");
                    }
                } else {
                    readCursor = store.openCursor();
                }
            }

            if (typeof (readCursor) == "undefined" || !readCursor) {
                options.error(new Error("No Cursor"));
            } else {
                readCursor.onerror = function(ev) {
                    const error = ev.target.error;
                    console.error("readCursor error", error, error.code, error.message, error.name, readCursor,
                                  storeName, collection);
                    options.error(error);
                };
                // Setup a handler for the cursor’s `success` event:
                readCursor.onsuccess = function (e) {
                    var cursor = e.target.result;
                    if (!cursor) {
                        if (options.addIndividually || options.clear) {
                            options.success(elements, true);
                        } else {
                            options.success(elements); // We're done. No more elements.
                        }
                    }
                    else {
                        // Cursor is not over yet.
                        if (options.abort || (options.limit && processed >= options.limit)) {
                            // Yet, we have processed enough elements. So, let's just skip.
                            if (bounds) {
                                if (options.conditions && options.conditions[index.keyPath]) {
                                    cursor["continue"](options.conditions[index.keyPath][1] + 1); /* We need to 'terminate' the cursor cleany, by moving to the end */
                                } else if (options.index && (options.index.upper || options.index.lower)) {
                                    if (typeof options.index.order === 'string' && options.index.order.toLowerCase() === 'desc') {
                                        cursor["continue"](options.index.lower);
                                    } else {
                                        cursor["continue"](options.index.upper);
                                    }
                                }
                            } else {
                                cursor["continue"](); /* We need to 'terminate' the cursor cleany, by moving to the end */
                            }
                        }
                        else if (options.offset && options.offset > skipped) {
                            skipped++;
                            cursor["continue"](); /* We need to Moving the cursor forward */
                        } else {
                            // This time, it looks like it's good!
                            if (!options.filter || typeof options.filter !== 'function' || options.filter(cursor.value)) {
                                if (options.addIndividually) {
                                    collection.add(cursor.value);
                                } else if (options.clear) {
                                    var deleteRequest = store['delete'](cursor.value[idAttribute]);
                                    deleteRequest.onsuccess = deleteRequest.onerror = function (event) {
                                        elements.push(cursor.value);
                                    };
                                } else {
                                    elements.push(cursor.value);
                                }
                            }
                            processed++;
                            cursor["continue"]();
                        }
                    }
                };
            }
        },
        close :function(){
            if(this.db){
                this.db.close();
            }
        }
    };

    // ExecutionQueue object
    // The execution queue is an abstraction to buffer up requests to the database.
    // It holds a "driver". When the driver is ready, it just fires up the queue and executes in sync.
    function ExecutionQueue(schema) {
        this.started    = false;
        this.failed     = false;
        this.stack      = [];
        this.version    = _.last(schema.migrations).version;
        this.driver     = new Driver(schema, this.ready.bind(this), this.error.bind(this));
    }

    // ExecutionQueue Prototype
    ExecutionQueue.prototype = {
        // Called when the driver is ready
        // It just loops over the elements in the queue and executes them.
        ready: function () {
            this.started = true;
            _.each(this.stack, this.execute, this);
            this.stack = null;
            const readyEvent = new Event('dbready');
            readyEvent.db = this.driver.db;
            self.dispatchEvent(readyEvent);
        },

        error: function() {
            this.failed = true;
            _.each(this.stack, this.execute, this);
            this.stack = null;
        },

        // Executes a given command on the driver. If not started, just stacks up one more element.
        execute: function (message) {
            if (this.started) {
                this.driver.execute(message[2].storeName || message[1].storeName, message[0], message[1], message[2]); // Upon messages, we execute the query
            } else if (this.failed) {
                message[2].error();
            } else {
                this.stack.push(message);
            }
        },

        close : function(){
            this.driver.close();
        }
    };

    // Method used by Backbone for sync of data with data store. It was initially designed to work with "server side" APIs, This wrapper makes
    // it work with the local indexedDB stuff. It uses the schema attribute provided by the object.
    // The wrapper keeps an active Executuon Queue for each "schema", and executes querues agains it, based on the object type (collection or
    // single model), but also the method... etc.
    // Keeps track of the connections
    var Databases = {};

    async function sync(method, object, options) {
        if (method === "closeall"){
            _.invoke(Databases, "close");
            // Clean up active databases object.
            Databases = {};
            return;
        }
        // If a model or a collection does not define a database, fall back on ajaxSync
        if (!object || !_.isObject(object.database)) {
            return Backbone.ajaxSync(method, object, options);
        }
        const schema = object.database;
        if (Databases[schema.id]) {
            if (Databases[schema.id].version != _.last(schema.migrations).version){
                Databases[schema.id].close();
                delete Databases[schema.id];
            }
        }
        return await new Promise((resolve, reject) => {
            const success_save = options.success;
            options.success = (resp, silenced) => {
                if (!silenced) {
                    success_save && success_save(resp);
                }
                resolve(resp);
            };
            const error_save = options.error;
            options.error = e => {
                error_save && error_save(e);
                reject(e);
            };

            if (!Databases[schema.id]) {
                Databases[schema.id] = new ExecutionQueue(schema);
            }
            Databases[schema.id].execute([method, object, options]);
        });
    }

    Backbone.ajaxSync = Backbone.sync;
    Backbone.sync = sync;

    return {sync};
}));
