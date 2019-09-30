// vim: ts=4:sw=4:expandtab
/* global Backbone */

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
            const latestVersion = _.last(this.schema.migrations).version;
            console.info(`Opening database ${this.schema.id} (v${latestVersion})`);
            const openRequest = indexedDB.open(this.schema.id, latestVersion);

            this.launchMigrationPath = dbVersion => {
                const transaction = openRequest.transaction;
                const clonedMigrations = _.clone(schema.migrations);
                this.migrate(transaction, clonedMigrations, dbVersion, {
                    error: ev => {
                        this.error = `Database not up to date. v${dbVersion} ` +
                                     `expected was ${latestVersion}`;
                    }
                });
            };

            openRequest.onblocked = ev => {
                this.error = "Connection to the database blocked";
                self.dispatchEvent(new Event('dbblocked'));
                this.onerror();
            };

            openRequest.onsuccess = ev => {
                const db = this.db = ev.target.result;
                db.onversionchange = ev => {
                    console.warn("Database version change requested somewhere: Closing our connection!");
                    try {
                        db.close();
                    } finally {
                        self.dispatchEvent(new Event('dbversionchange'));
                    }
                };
                const currentVersion = this.db.version;
                if (currentVersion === latestVersion) {
                    this.ready();
                } else if (currentVersion < latestVersion ) {
                    // Legacy clients only.
                    this.launchMigrationPath(currentVersion);
                } else {
                    this.error = `Database version is greater than current code v${currentVersion} ` +
                                 ` expected was v${latestVersion}`;
                }
            };

            openRequest.onerror = ev => {
                this.error = "Could not connect to the database";
                console.error(this.error, ev);
                this.onerror();
            };

            openRequest.onabort = ev => {
                this.error = "Connection to the database aborted";
                console.error(this.error, ev);
                this.onerror();
            };

            openRequest.onupgradeneeded = ev => {
                console.warn(`Database upgrade needed: v${ev.oldVersion} => v${ev.newVersion}`);
                this.db = ev.target.result;
                this.launchMigrationPath(ev.oldVersion);
            };
        }

        // Performs all the migrations to reach the right version of the database.
        migrate(transaction, migrations, version, options) {
            console.info(`DB migrate begin version from v${version}`);
            transaction.onerror = options.error;
            transaction.onabort = options.error;
            const migration = migrations.shift();
            if (migration) {
                if (!version || version < migration.version) {
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
                                    this.migrate(transaction, migrations, version, options);
                                }
                            });
                        });
                    });
                } else {
                    // No need to apply this migration
                    this.migrate(transaction, migrations, version, options);
                }
            }
        }

        execute(storeName, method, storable, options) {
            if (method === 'create') {
                this.create(storeName, storable, options);
            } else if (method === 'read') {
                if (storable.id || storable.cid) {
                    this.read(storeName, storable, options);
                } else {
                    this.query(storeName, storable, options);
                }
            } else if (method === 'update') {
                this.update(storeName, storable, options);
            } else if (method === 'delete') {
                if (storable.id || storable.cid) {
                    this.delete(storeName, storable, options);
                } else {
                    assertCollection(storable);
                    this.clear(storeName, options);
                }
            } else if (method === 'noop') {
                options.success();
                return;
            } else {
                throw new Error(`Unexpected method: ${method}`);
            }
        }

        create(storeName, model, options) {
            if (this.schema.readonly) {
                throw new Error("Database is readonly");
            }
            assertModel(model);
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
            if (writeTransaction.commit) {
                writeTransaction.commit();
            }
        }

        update(storeName, model, options) {
            if (this.schema.readonly) {
                throw new Error("Database is readonly");
            }
            assertModel(model);
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
            if (writeTransaction.commit) {
                writeTransaction.commit();
            }
        }

        read(storeName, model, options) {
            assertModel(model);
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
                        options.success();
                    } else {
                        options.error(new NotFound(keyIdent));
                    }
                };
                getRequest.onerror = e => {
                    if (options.not_found_error === false) {
                        options.success();
                    } else {
                        options.error(new NotFound(keyIdent));
                    }
                };
            } else if (options.not_found_error === false) {
                options.success();
            } else {
                options.error(new NotFound(keyIdent));
            }
        }

        // Deletes the json.id key and value in storeName from db.
        delete(storeName, model, options) {
            if (this.schema.readonly) {
                throw new Error("Database is readonly");
            }
            assertModel(model);
            const deleteTransaction = this.db.transaction([storeName], 'readwrite');
            const store = deleteTransaction.objectStore(storeName);
            const json = model.toJSON();
            const idAttribute = store.keyPath || _.result(model, 'idAttribute');
            const deleteRequest = store.delete(json[idAttribute]);
            deleteTransaction.oncomplete = () => options.success(null);
            deleteRequest.onerror = () => options.error(new Error("Not Deleted"));
            if (deleteTransaction.commit) {
                deleteTransaction.commit();
            }
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
            assertCollection(collection);
            if (options.clear || options.addIndividually) {
                throw new TypeError("Deprecated option");
            }
            const elements = [];
            let skipped = 0;
            let processed = 0;
            const queryTransaction = this.db.transaction([storeName], "readonly");
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
                        options.success(elements); // We're done. No more elements.
                    } else {
                        // Cursor is not over yet.
                        if (options.limit && processed >= options.limit) {
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
                                elements.push(cursor.value);
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
    
    const idbInterfaces = new Map();

    // Method used by Backbone for sync of data with data store. It was initially
    // designed to work with "server side" APIs, This wrapper makes it work with
    // IndexedDB. It uses the schema attribute provided by the storable.
    // The wrapper keeps an active Executuon Queue for each "schema", and
    // executes querues agains it, based on the storable type (collection or single
    // model), but also the method... etc.
    async function syncIDB(method, storable, options) {
        options = options || {};
        if (method === "closeall"){
            for (const q of idbInterfaces.values()) {
                q.close();
            }
            idbInterfaces.clear();
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
            if (!idbInterfaces.has(schema.id)) {
                idbInterfaces.set(schema.id, new IDBInterface(schema));
            }
            idbInterfaces.get(schema.id).execute(method, storable, options);
        });
    }


    class RPCInterface {

        constructor(schema) {
            this.version = _.last(schema.migrations).version;
            this.schema = schema;
            this.ready = new Promise(resolve => this._setReady = resolve);
            if (!this.schema.id) {
                throw new Error("No Database ID");
            }
        }

        async init() {
            console.info(`Opening RPC database ${this.schema.id} (v${this.version})`);
            F.parentRPC.addEventListener('db-gateway-blocked', schemaId => {
                if (schemaId === this.schema.id) {
                    self.dispatchEvent(new Event('dbblocked'));
                }
            });
            F.parentRPC.addEventListener('db-gateway-versionchange', schemaId => {
                if (schemaId === this.schema.id) {
                    self.dispatchEvent(new Event('dbversionchange'));
                }
            });
            await F.parentRPC.invokeCommand('db-gateway-init', {
                name: this.schema.name,
                id: this.schema.id,
                version: this.version
            });
            this._setReady();
            const readyEvent = new Event('dbready');
            readyEvent.db = {name: this.schema.id};  // keep compat with native idb event.
            self.dispatchEvent(readyEvent);
        }

        async execute(method, storable, options) {
            const storeName = options.storeName || storable.storeName;
            if (method === 'create') {
                return await this.create(storeName, storable);
            } else if (method === 'read') {
                if (storable.id || storable.cid) {
                    return await this.read(storeName, storable, options.index,
                                           options.not_found_error === false);
                } else {
                    return await this.query(storeName, storable, options);
                }
            } else if (method === 'update') {
                return await this.update(storeName, storable);
            } else if (method === 'delete') {
                if (storable.id || storable.cid) {
                    return await this.delete(storeName, storable);
                } else {
                    assertCollection(storable);
                    return await this.clear(storeName);
                }
            } else if (method === 'noop') {
                console.error("XXX port");
                return;
            } else {
                throw new Error(`Unexpected method: ${method}`);
            }
        }

        async create(storeName, model) {
            if (this.schema.readonly) {
                throw new Error("Database is readonly");
            }
            assertModel(model);
            const json = model.toJSON();
            const idAttribute = _.result(model, 'idAttribute');
            const idFallback = json[idAttribute] === undefined ? F.util.uuid4() : undefined;
            return await F.parentRPC.invokeCommand(`db-gateway-create-${this.schema.id}`, {
                storeName,
                json,
                idAttribute,
                idFallback,
            });

        }

        async update(storeName, model) {
            if (this.schema.readonly) {
                throw new Error("Database is readonly");
            }
            assertModel(model);
            const json = model.toJSON();
            const idAttribute = _.result(model, 'idAttribute');
            if (!json[idAttribute]) {
                json[idAttribute] = F.util.uuid4();
            }
            return await F.parentRPC.invokeCommand(`db-gateway-update-${this.schema.id}`, {
                storeName,
                json,
                idAttribute
            });
        }

        async read(storeName, model, index, notFoundOkay) {
            assertModel(model);
            const json = model.toJSON();
            const idAttribute = _.result(model, 'idAttribute');
            let keyIdent;
            if (json[idAttribute]) {
                keyIdent = json[idAttribute];
            } else if (index) {
                keyIdent = index.value;
            }
            const result = await F.parentRPC.invokeCommand(`db-gateway-read-${this.schema.id}`, {
                storeName,
                json,
                idAttribute,
                index,
            });
            if (!result && !notFoundOkay) {
                throw new NotFound(keyIdent);
            }
            return result;
        }

        async delete(storeName, model) {
            if (this.schema.readonly) {
                throw new Error("Database is readonly");
            }
            assertModel(model);
            const json = model.toJSON();
            const idAttribute = _.result(model, 'idAttribute');
            return await F.parentRPC.invokeCommand(`db-gateway-delete-${this.schema.id}`, {
                storeName,
                json,
                idAttribute
            });
        }

        async clear(storeName) {
            if (this.schema.readonly) {
                throw new Error("Database is readonly");
            }
            return await F.parentRPC.invokeCommand(`db-gateway-clear-${this.schema.id}`, {storeName});
        }

        async query(storeName, collection, options) {
            assertCollection(collection);
            if (options.clear) {
                throw new TypeError("Deprecated 'clear' option");
            }
            const idAttribute = collection.idAttribute || _.result(collection.model.prototype, 'idAttribute');
            const hasFilter = !!options.filter;
            const filterSig = hasFilter ? F.util.uuid4() : null;
            if (hasFilter) {
                F.parentRPC.addCommandHandler(`db-gateway-query-filter-callback-${filterSig}`, options.filter);
            }
            try {
                const result = await F.parentRPC.invokeCommand(`db-gateway-query-${this.schema.id}`, {
                    storeName,
                    idAttribute,
                    index: options.index,
                    conditions: options.conditions,
                    range: options.range,
                    limit: options.limit,
                    offset: options.offset,
                    hasFilter,
                    filterSig
                });
                options.success(result.elements, result.silenced);
            } catch(e) {
                options.error(e);
            } finally {
                if (hasFilter) {
                    F.parentRPC.removeCommandHandler(`db-gateway-query-filter-callback-${filterSig}`, options.filter);
                }
            }
        }
    }


    const rpcInterfaces = new Map();

    // RPC proxy for sync method.  The intended recipient is a controlling parent window frame
    // object that is running the forsta-messenger-client.
    async function syncRPC(method, storable, options) {
        options = options || {};
        if (method === "closeall"){
            throw new Error("Unexpected method passed to sync");
        }
        const schema = storable.database;
        let rpcInterface = rpcInterfaces.get(schema.id);
        if (!rpcInterface) {
            rpcInterface = new RPCInterface(schema);
            rpcInterfaces.set(schema.id, rpcInterface);
            try {
                await rpcInterface.init();
            } catch(e) {
                reject(e);
            }
        } else {
            await rpcInterface.ready;
        }
        let result;
        try {
            result = await rpcInterface.execute(method, storable, options);
        } catch(e) {
            if (options.error) {
                options.error(e);
            }
            throw e;
        }
        if (options.success) {
            options.success(result);
        }
        return result;
    }


    const syncOrig = Backbone.sync;
    Backbone.sync = function(method, storable, options) {
        let sync;
        if (!storable || !storable.database) {
            sync = syncOrig;
        } else if (F.managedConfig) {
            sync = syncRPC;
            delete self.indexedDB; // XXX Prevent leaks
        } else {
            sync = syncIDB;
        }
        return sync.apply(this, arguments);
    };

    /**
     * Make Backbone's save method serialized to avoid corruption.
     * Multiple calls to the Model.save for the same model will result in
     * race conditions.
     */
    const _Backbone_Model_save = Backbone.Model.prototype.save;
    Backbone.Model.prototype.save = async function() {
        let res;
        if (this.storeName) {
            res = await F.queueAsync(`Backbone.save-${this.storeName}-${this.cid}`,
                                     () => _Backbone_Model_save.apply(this, arguments));
        } else {
            res = await _Backbone_Model_save.apply(this, arguments);
        }
        this.trigger('save', this);
        return res;
    };

    Backbone.initDatabase = async function(database) {
        if (F.managedConfig) {
            await syncRPC('noop', {database});
        } else {
            await syncIDB('noop', {database});
        }
    };
})();
