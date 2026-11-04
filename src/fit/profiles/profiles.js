/*
 * profiles.js: front-end client module.
 *
 * Why this exists:
 * This file is part of Athlima and is kept separate so the application can be understood
 * as a set of focused responsibilities instead of one large unstructured script.
 * The code here is intentionally organized around one job so a new contributor can
 * follow the data flow and the reason for each step without reading unrelated code.
 *
 * What it does:
 * reads, writes, and validates FIT files so training data can be stored and exchanged reliably.
 *
 * Developer note:
 * Read this file as the boundary of the problem it solves: inputs, transformations,
 * persistence, and outputs. If a change affects the behaviour of this module, update
 * the tests and the surrounding callers in the same review.
 */

//
// Profiles
//
// merge, shape, and export, data from the global and product profile json files
//

import { exists, equals } from '../../functions.js';

import { BaseType, BaseTypeDefinitions, } from './base-types.js';
import global_message_definitions from './global-message-definitions.js';
import global_type_definitions from './global-type-definitions.js';
import global_field_definitions from './global-field-definitions.js';

function Profiles(args = {}) {

    // merge product types, messages, and fields with the global ones
    const types = global_type_definitions;
    const messages = global_message_definitions;
    const fields = global_field_definitions;

    // methods
    function numberToMessageName(number) {
        return types['mesg_num'].values[(number).toString()] ?? `message_${number}`;
    }

    // String -> Field{}
    function Field(name) {
        return {name, ...(fields[name] ?? {})};
    }

    // Int -> Field{
    //     name: String,
    //     type: String,
    //     base_type: BaseType,
    //     units: String,
    //     scale: Int,
    //     offset: Int,
    //     bits: Int,
    //     accumulate: String
    // }
    function numberToField(messageName, fieldNumber) {
        const message = messages[messageName];
        if(!exists(message)) {
            return Field(`field_${fieldNumber}`);
        }
        const messageFields = message.fields;
        for(let fieldName in messageFields) {
            if(equals(messageFields[fieldName], fieldNumber)) return Field(fieldName);
        }
        return Field(`field_${fieldNumber}`);
    }

    function messageNameToNumber(name) {
        return types.mesg_num.values[name] ?? 0xFFFF;
    }

    // String -> GlobalFieldDefinition{}
    function fieldNameToField(fieldName) {
        return fields[fieldName];
    }

    function fieldNameToNumber(messageName, fieldName) {
        return messages[messageName].fields[fieldName];
    }

    function fieldNameToSize(name) {
        return BaseTypeDefinitions[fields[name].base_type].size;
    }

    function fieldNameToBaseType(name) {
        return fields[name].base_type;
    }

    function baseTypeToSize(base_type) {
        return BaseTypeDefinitions[base_type].size;
    }

    return Object.freeze({
        BaseType,
        BaseTypeDefinitions,
        types,
        messages,
        fields,

        numberToMessageName,
        messageNameToNumber,

        numberToField,
        fieldNameToField,
        fieldNameToNumber,
        fieldNameToSize,
        fieldNameToBaseType,
        baseTypeToSize,
    });
}


function toDualKeyMap(source, first_key, second_key) {
    return source.reduce(function (acc, sourceItem) {
        acc.set(sourceItem[first_key], sourceItem);
        acc.set(sourceItem[second_key], sourceItem);
        return acc;
    }, new Map());
}

const profiles = Profiles();

export {
    Profiles,
    profiles,
};

