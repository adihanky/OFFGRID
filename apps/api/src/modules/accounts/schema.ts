import { MongoServerError, type Db, type Document } from 'mongodb';
export const oid = { bsonType: 'objectId' };
export const date = { bsonType: 'date' };
export const text = { bsonType: 'string' };
export const long = { bsonType: 'long' };
export const status = { enum: ['active', 'disabled'] };
export async function collectionSchema(
  db: Db,
  name: string,
  properties: Document,
  required = Object.keys(properties),
  extra: Document = {},
) {
  const validator = {
    $jsonSchema: {
      bsonType: 'object',
      required,
      properties: { _id: oid, ...properties },
      ...extra,
    },
  };
  try {
    await db.createCollection(name, { validator });
  } catch (error) {
    if (!(error instanceof MongoServerError) || error.code !== 48) throw error;
    await db.command({
      collMod: name,
      validator,
      validationLevel: 'strict',
      validationAction: 'error',
    });
    if (await db.collection(name).findOne({ $nor: [validator] }))
      throw new Error(`Incompatible data in ${name}; migration required.`, { cause: error });
  }
}
