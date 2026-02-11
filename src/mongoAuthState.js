const { proto } = require('@whiskeysockets/baileys');
const { BufferJSON, initAuthCreds } = require('@whiskeysockets/baileys');

async function useMongoDBAuthState(collection) {
    // Escribir datos (creds o keys)
    const writeData = async (data, id) => {
        await collection.updateOne(
            { _id: id },
            { $set: JSON.parse(JSON.stringify(data, BufferJSON.replacer)) },
            { upsert: true }
        );
    };

    // Leer datos
    const readData = async (id) => {
        try {
            const data = await collection.findOne({ _id: id });
            if (data) {
                return JSON.parse(JSON.stringify(data), BufferJSON.reviver);
            }
            return null;
        } catch (error) {
            return null;
        }
    };

    // Borrar datos
    const removeData = async (id) => {
        await collection.deleteOne({ _id: id });
    };

    // Cargar credenciales iniciales
    const creds = (await readData('creds')) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            let value = await readData(`${type}-${id}`);
                            if (type === 'app-state-sync-key' && value) {
                                value = proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            data[id] = value;
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            tasks.push(value ? writeData(value, key) : removeData(key));
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: () => {
            return writeData(creds, 'creds');
        }
    };
}

module.exports = { useMongoDBAuthState };
