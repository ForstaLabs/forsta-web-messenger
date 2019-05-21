// vim: ts=4:sw=4:expandtab
/* global Backbone ifrpc */

(function () {

    class NotFound extends ReferenceError {
        constructor(key) {
            super('Not Found');
            this.name = 'NotFound';
            this.key = key;
        }
    }

    function assertModel(obj) {
        if (!(obj instanceof Backbone.Model)) {
            throw new TypeError("Model expected");
        }
    }

    function assertCollection(obj) {
        if (!(obj instanceof Backbone.Collection)) {
            throw new TypeError("Collection expected");
        }
    }

    // There is a driver for each schema provided. The schema is a the combination of name
    // for the database, a version as well as migrations to reach that version of the database.
    class IDBDriver {
        constructor(schema, ready, onerror) {
            this.schema = schema;
            this.ready = ready;
            this.error = null;
            this.db = null;
            this.onerror = onerror;
            if (!this.schema.id) {
                throw new Error("No Database ID");
            }
            var lastMigrationPathVersion = _.last(this.schema.migrations).version;
            console.info("Opening database " + this.schema.id + " in version #" + lastMigrationPathVersion);
            this.dbRequest = indexedDB.open(this.schema.id, lastMigrationPathVersion); //schema version need to be an unsigned long

            this.launchMigrationPath = dbVersion => {
                var transaction = this.dbRequest.transaction;
                var clonedMigrations = _.clone(schema.migrations);
                this.migrate(transaction, clonedMigrations, dbVersion, {
                    error: ev => {
                        this.error = "Database not up to date. " + dbVersion +
                                     " expected was " + lastMigrationPathVersion;
                    }
                });
            };

            this.dbRequest.onblocked = ev => {
                this.error = "Connection to the database blocked";
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
                // we need convert beacuse chrome store in integer and ie10 DP4+ in int;
                var currentIntDBVersion = (parseInt(this.db.version) ||  0);
                // And make sure we compare numbers with numbers.
                var lastMigrationInt = (parseInt(lastMigrationPathVersion) || 0);

                //if support new event onupgradeneeded will trigger the ready function
                if (currentIntDBVersion === lastMigrationInt) {
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

        // Performs all the migrations to reach the right version of the database.
        migrate(transaction, migrations, version, options) {
            transaction.onerror = options.error;
            transaction.onabort = options.error;

            console.info("DB migrate begin version from #" + version);
            var that = this;
            var migration = migrations.shift();
            if (migration) {
                if (!version || version < migration.version) {
                    // We need to apply this migration-
                    if (typeof migration.before == "undefined") {
                        migration.before = next => next();
                    }
                    if (typeof migration.after == "undefined") {
                        migration.after = next => next();
                    }
                    migration.before(() => {
                        console.warn("DB migrating to:", migration.version);
                        migration.migrate(transaction, () => {
                            migration.after(() => {
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
        }

        execute(storeName, method, storable, options) {
            switch (method) {
                case "create":
                    assertModel(storable);
                    this.create(storeName, storable, options);
                    break;
                case "read":
                    if (storable.id || storable.cid) {
                        assertModel(storable);
                        this.read(storeName, storable, options);
                    } else {
                        assertCollection(storable);
                        this.query(storeName, storable, options);
                    }
                    break;
                case "update":
                    assertModel(storable);
                    this.update(storeName, storable, options);
                    break;
                case "delete":
                    if (storable.id || storable.cid) {
                        assertModel(storable);
                        this.delete(storeName, storable, options);
                    } else {
                        assertCollection(storable);
                        this.clear(storeName, options);
                    }
                    break;
                default:
                    throw new Error(`Unexpected method: ${method}`);
            }
        }

        create(storeName, model, options) {
            if (this.schema.readonly) {
                throw new Error("Database is readonly");
            }
            const writeTransaction = this.db.transaction([storeName], 'readwrite');
            const store = writeTransaction.objectStore(storeName);
            const json = model.toJSON();
            const idAttribute = _.result(model, 'idAttribute');
            if (json[idAttribute] === undefined && !store.autoIncrement) {
                json[idAttribute] = F.util.uuid4();
            }
            writeTransaction.onerror = e => options.error(e);
            writeTransaction.oncomplete = () => options.success(json);
            if (!store.keyPath) {
                store.add(json, json[idAttribute]);
            } else {
                store.add(json);
            }
        }

        update(storeName, model, options) {
            if (this.schema.readonly) {
                throw new Error("Database is readonly");
            }
            const writeTransaction = this.db.transaction([storeName], 'readwrite');
            const store = writeTransaction.objectStore(storeName);
            const json = model.toJSON();
            const idAttribute = _.result(model, 'idAttribute');
            let writeRequest;
            if (!json[idAttribute]) {
                json[idAttribute] = F.util.uuid4();
            }
            if (!store.keyPath) {
                writeRequest = store.put(json, json[idAttribute]);
            } else {
                writeRequest = store.put(json);
            }
            writeRequest.onerror = e => options.error(e);
            writeTransaction.oncomplete = () => options.success(json);
        }

        read(storeName, model, options) {
            const readTransaction = this.db.transaction([storeName], "readonly");
            const store = readTransaction.objectStore(storeName);
            const json = model.toJSON();
            const idAttribute = _.result(model, 'idAttribute');
            let getRequest = null;
            let keyIdent;
            if (json[idAttribute]) {
                keyIdent = json[idAttribute];
                getRequest = store.get(keyIdent);
            } else if (options.index) {
                const index = store.index(options.index.name);
                keyIdent = options.index.value;
                getRequest = index.get(keyIdent);
            } else {
                // We need to find which index we have
                let cardinality = 0; // try to fit the index with most matches
                _.each(store.indexNames, key => {
                    const index = store.index(key);
                    if (typeof index.keyPath === 'string' && 1 > cardinality) {
                        // simple index
                        if (json[index.keyPath] !== undefined) {
                            keyIdent = json[index.keyPath];
                            getRequest = index.get(keyIdent);
                            cardinality = 1;
                        }
                    } else if(typeof index.keyPath === 'object' && index.keyPath.length > cardinality) {
                        // compound index
                        let valid = true;
                        const keyValue = _.map(index.keyPath, keyPart => {
                            valid = valid && json[keyPart] !== undefined;
                            return json[keyPart];
                        });
                        if (valid) {
                            keyIdent = keyValue;
                            getRequest = index.get(keyIdent);
                            cardinality = index.keyPath.length;
                        }
                    }
                });
            }
            if (getRequest) {
                getRequest.onsuccess = ev => {
                    if (ev.target.result) {
                        options.success(ev.target.result);
                    } else if (options.not_found_error === false) {
                        options.success(undefined);
                    } else {
                        options.error(new NotFound(keyIdent));
                    }
                };
                getRequest.onerror = e => {
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
        }

        // Deletes the json.id key and value in storeName from db.
        delete(storeName, model, options) {
            if (this.schema.readonly) {
                throw new Error("Database is readonly");
            }
            const deleteTransaction = this.db.transaction([storeName], 'readwrite');
            const store = deleteTransaction.objectStore(storeName);
            const json = model.toJSON();
            const idAttribute = store.keyPath || _.result(model, 'idAttribute');
            const deleteRequest = store.delete(json[idAttribute]);
            deleteTransaction.oncomplete = () => options.success(null);
            deleteRequest.onerror = () => options.error(new Error("Not Deleted"));
        }

        clear(storeName, options) {
            if (this.schema.readonly) {
                throw new Error("Database is readonly");
            }
            const deleteTransaction = this.db.transaction([storeName], "readwrite");
            const store = deleteTransaction.objectStore(storeName);
            const deleteRequest = store.clear();
            deleteRequest.onsuccess = () => options.success(null);
            deleteRequest.onerror = () => options.error("Not Cleared");
        }

        // Performs a query on storeName in db.
        // options may include :
        // - conditions : value of an index, or range for an index
        // - range : range for the primary key
        // - limit : max number of elements to be yielded
        // - offset : skipped items.
        query(storeName, collection, options) {
            const elements = [];
            let skipped = 0;
            let processed = 0;
            const queryTransaction = this.db.transaction([storeName], "readonly");
            const idAttribute = collection.idAttribute || _.result(collection.model.prototype, 'idAttribute');
            const store = queryTransaction.objectStore(storeName);

            let readCursor;
            let bounds;
            let index;
            if (options.conditions) {
                // We have a condition, we need to use it for the cursor
                _.each(store.indexNames, key => {
                    if (!readCursor) {
                        index = store.index(key);
                        if (options.conditions[index.keyPath] instanceof Array) {
                            const lower = options.conditions[index.keyPath][0] > options.conditions[index.keyPath][1] ?
                                          options.conditions[index.keyPath][1] :
                                          options.conditions[index.keyPath][0];
                            const upper = options.conditions[index.keyPath][0] > options.conditions[index.keyPath][1] ?
                                          options.conditions[index.keyPath][0] :
                                          options.conditions[index.keyPath][1];
                            bounds = IDBKeyRange.bound(lower, upper, true, true);
                            if (options.conditions[index.keyPath][0] > options.conditions[index.keyPath][1]) {
                                // Looks like we want the DESC order
                                readCursor = index.openCursor(bounds, IDBCursor.PREV || "prev");
                            } else {
                                // We want ASC order
                                readCursor = index.openCursor(bounds, IDBCursor.NEXT || "next");
                            }
                        } else if (typeof options.conditions[index.keyPath] === 'object' &&
                                   ('$gt' in options.conditions[index.keyPath] ||
                                    '$gte' in options.conditions[index.keyPath])) {
                            if ('$gt' in options.conditions[index.keyPath])
                                bounds = IDBKeyRange.lowerBound(options.conditions[index.keyPath]['$gt'], true);
                            else
                                bounds = IDBKeyRange.lowerBound(options.conditions[index.keyPath]['$gte']);
                            readCursor = index.openCursor(bounds, IDBCursor.NEXT || "next");
                        } else if (typeof options.conditions[index.keyPath] === 'object' &&
                                   ('$lt' in options.conditions[index.keyPath] ||
                                    '$lte' in options.conditions[index.keyPath])) {
                            let bounds;
                            if ('$lt' in options.conditions[index.keyPath])
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
                        bounds = IDBKeyRange.bound(options.index.lower, options.index.upper,
                                                   excludeLower, excludeUpper);
                    } else if (options.index.lower) {
                        bounds = IDBKeyRange.lowerBound(options.index.lower, excludeLower);
                    } else if (options.index.upper) {
                        bounds = IDBKeyRange.upperBound(options.index.upper, excludeUpper);
                    } else if (options.index.only) {
                        bounds = IDBKeyRange.only(options.index.only);
                    }
                    if (typeof options.index.order === 'string' &&
                        options.index.order.toLowerCase() === 'desc') {
                        readCursor = index.openCursor(bounds, IDBCursor.PREV || "prev");
                    } else {
                        readCursor = index.openCursor(bounds, IDBCursor.NEXT || "next");
                    }
                }
            } else {
                // No conditions, use the index
                if (options.range) {
                    const lower = options.range[0] > options.range[1] ? options.range[1] : options.range[0];
                    const upper = options.range[0] > options.range[1] ? options.range[0] : options.range[1];
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

            if (typeof readCursor == "undefined" || !readCursor) {
                options.error(new Error("No Cursor"));
            } else {
                readCursor.onerror = ev => {
                    const error = ev.target.error;
                    console.error("readCursor error", error, error.code, error.message, error.name, readCursor,
                                  storeName, collection);
                    options.error(error);
                };
                // Setup a handler for the cursor’s `success` event:
                readCursor.onsuccess = ev => {
                    const cursor = ev.target.result;
                    if (!cursor) {
                        if (options.addIndividually || options.clear) {
                            options.success(elements, /*silenced*/ true);
                        } else {
                            options.success(elements); // We're done. No more elements.
                        }
                    } else {
                        // Cursor is not over yet.
                        if (options.abort || (options.limit && processed >= options.limit)) {
                            // Yet, we have processed enough elements. So, let's just skip.
                            if (bounds) {
                                if (options.conditions && options.conditions[index.keyPath]) {
                                    // We need to 'terminate' the cursor cleany, by moving to the end
                                    cursor.continue(options.conditions[index.keyPath][1] + 1);
                                } else if (options.index && (options.index.upper || options.index.lower)) {
                                    if (typeof options.index.order === 'string' &&
                                        options.index.order.toLowerCase() === 'desc') {
                                        cursor.continue(options.index.lower);
                                    } else {
                                        cursor.continue(options.index.upper);
                                    }
                                }
                            } else {
                                // We need to 'terminate' the cursor cleany, by moving to the end
                                cursor.continue();
                            }
                        }
                        else if (options.offset && options.offset > skipped) {
                            skipped++;
                            cursor.continue(); // We need to Moving the cursor forward
                        } else {
                            // This time, it looks like it's good!
                            if (!options.filter || typeof options.filter !== 'function' || options.filter(cursor.value)) {
                                processed++;
                                if (options.addIndividually) {
                                    collection.add(cursor.value);
                                } else if (options.clear) {
                                    var deleteRequest = store.delete(cursor.value[idAttribute]);
                                    deleteRequest.onsuccess = deleteRequest.onerror = event => {
                                        elements.push(cursor.value);
                                    };
                                } else {
                                    elements.push(cursor.value);
                                }
                            }
                            cursor.continue();
                        }
                    }
                };
            }
        }

        close() {
            if(this.db){
                this.db.close();
            }
        }
    }

    class IDBInterface {
        constructor(schema) {
            this.started = false;
            this.failed = false;
            this.stack = [];
            this.version = _.last(schema.migrations).version;
            this.driver = new IDBDriver(schema, this.ready.bind(this), this.error.bind(this));
        }

        ready() {
            this.started = true;
            for (const args of this.stack) {
                this.execute.apply(this, args);
            }
            this.stack = null;
            const readyEvent = new Event('dbready');
            readyEvent.db = this.driver.db;
            self.dispatchEvent(readyEvent);
        }

        error() {
            this.failed = true;
            for (const args of this.stack) {
                this.execute.apply(this, args);
            }
            this.stack = null;
        }

        execute(method, storable, options) {
            const storeName = options.storeName || storable.storeName;
            if (this.started) {
                this.driver.execute(storeName, method, storable, options);
            } else if (this.failed) {
                options.error(this.driver.error);
            } else {
                this.stack.push([method, storable, options]);
            }
        }

        close(){
            this.driver.close();
        }
    }
    
    const idbs = new Map();

    // Method used by Backbone for sync of data with data store. It was initially
    // designed to work with "server side" APIs, This wrapper makes it work with
    // IndexedDB. It uses the schema attribute provided by the storable.
    // The wrapper keeps an active Executuon Queue for each "schema", and
    // executes querues agains it, based on the storable type (collection or single
    // model), but also the method... etc.
    async function syncIDB(method, storable, options) {
        if (method === "closeall"){
            for (const q of idbs.values()) {
                q.close();
            }
            idbs.clear();
            return;
        }
        return await new Promise((resolve, reject) => {
            const optionedSuccessCallback = options.success;
            options.success = (resp, silenced) => {
                try {
                    if (!silenced && optionedSuccessCallback) {
                        optionedSuccessCallback(resp);
                    }
                } finally {
                    resolve(resp);
                }
            };
            const optionedErrorCallback = options.error;
            options.error = e => {
                try {
                    if (optionedErrorCallback) {
                        optionedErrorCallback(e);
                    }
                } finally {
                    reject(e);
                }
            };
            const schema = storable.database;
            if (!idbs.has(schema.id)) {
                idbs.set(schema.id, new IDBInterface(schema));
            }
            idbs.get(schema.id).execute(method, storable, options);
        });
    }

    async function syncRPC(method, storable, options) {
        const database = storable.database;
        const optionedSuccessCallback = options.success;
        const optionedErrorCallback = options.error;
        delete options.success;
        delete options.error;
        const data = {
            type: storable instanceof Backbone.Model ? 'model' : 'collection',
            json: storable.toJSON(),
            database: {
                id: database.id
            },
            storeName: storable.storeName
        };
        if (data.type === 'model') {
            data.idAttribute = _.result(storable, 'idAttribute');
        } else {
            data.idAttribute = _.result(storable.model.prototype, 'idAttribute');
        }
        const filter = options.filter;
        if (filter) {
            console.warn("Function based filters are not well supported");
            // paging / limits are not handled because we cant send this func to
            // the other side safely.
            delete options.filter;
        }
        if (method in new Set('update', 'create', 'delete')) {
            throw new Error("Mutation not supported");
        }
        try {
            let result = await database.rpc.invokeCommand('backbone-sync', method, data, options);
            if (filter) {
                result = result.filter(filter);
            }
            if (optionedSuccessCallback) {
                optionedSuccessCallback(result);
            }
            return result;
        } catch(e) {
            let exc = e;
            if (e instanceof ifrpc.RemoteError) {
                if (e.remoteError.name === 'NotFound') {
                    exc = new NotFound(e.remoteError.key);
                }
            }
            if (optionedErrorCallback) {
                optionedErrorCallback(exc);
            }
            throw exc;
        }
    }

    Backbone.syncStock = Backbone.sync;
    Backbone.sync = function(method, storable, options) {
        if (!storable || !storable.database) {
            return Backbone.syncStock.apply(this, arguments);
        } else if (storable.database.rpc) {
            return syncRPC.apply(this, arguments);
        } else {
            return syncIDB.apply(this, arguments);
        }
    };

    Backbone.initBackingRPCHandlers = function(rpc) {
        rpc.addCommandHandler('backbone-sync', async (method, data, options) => {
            let storable;
            if (data.type === 'collection') {
                storable = new Backbone.Collection(data.json);
            } else {
                storable = new Backbone.Model(data.json);
            }
            storable.idAttribute = data.idAttribute;
            storable.database = data.database;
            storable.storeName = data.storeName;
            return await syncIDB(method, storable, options);
        });
    };

    /**
     * Make Backbone's save method serialized to avoid corruption.
     * Multiple calls to the Model.save for the same model will result in
     * race conditions.
     */
    const _Backbone_Model_save = Backbone.Model.prototype.save;
    Backbone.Model.prototype.save = async function() {
        if (this.storeName) {
            return await F.queueAsync(`Backbone.save-${this.storeName}-${this.cid}`,
                                      () => _Backbone_Model_save.apply(this, arguments));
        } else {
            return await _Backbone_Model_save.apply(this, arguments);
        }
    };
})();
