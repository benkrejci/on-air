/* tslint:disable */
// generated by typescript-json-validator
import {inspect} from 'util';
import Ajv = require('ajv');
import {RawConfig} from './config';
export const ajv = new Ajv({"allErrors":true,"coerceTypes":false,"format":"fast","nullable":true,"unicode":true,"uniqueItems":true,"useDefaults":true});

ajv.addMetaSchema(require('ajv/lib/refs/json-schema-draft-06.json'));

export {RawConfig};
export const RawConfigSchema = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "defaultProperties": [
  ],
  "definitions": {
    "TransformFunction": {
      "enum": [
        "CONSTANT",
        "EXP",
        "LINEAR",
        "LOG",
        "SIN"
      ],
      "type": "string"
    },
    "TransformFunctionRawConfig": {
      "defaultProperties": [
      ],
      "properties": {
        "coefficient": {
          "type": "number"
        },
        "function": {
          "$ref": "#/definitions/TransformFunction"
        },
        "max": {
          "type": "number"
        },
        "min": {
          "type": "number"
        },
        "offset": {
          "type": "number"
        },
        "period": {
          "type": "number"
        },
        "value": {
          "type": "number"
        }
      },
      "required": [
        "function"
      ],
      "type": "object"
    }
  },
  "properties": {
    "box": {
      "defaultProperties": [
      ],
      "properties": {
        "defaultBrightness": {
          "type": "number"
        },
        "globalStatusOutputsByName": {
          "additionalProperties": {
            "anyOf": [
              {
                "defaultProperties": [
                ],
                "properties": {
                  "inverted": {
                    "type": "boolean"
                  },
                  "mode": {
                    "enum": [
                      "ON_OFF",
                      "PWM"
                    ],
                    "type": "string"
                  },
                  "pin": {
                    "type": "number"
                  },
                  "range": {
                    "type": "number"
                  }
                },
                "required": [
                  "pin"
                ],
                "type": "object"
              },
              {
                "type": "number"
              }
            ]
          },
          "defaultProperties": [
          ],
          "type": "object"
        },
        "inputDebounceDelay": {
          "type": "number"
        },
        "inputsByName": {
          "additionalProperties": {
            "anyOf": [
              {
                "defaultProperties": [
                ],
                "properties": {
                  "action": {
                    "enum": [
                      "BRIGHTNESS",
                      "STATUS"
                    ],
                    "type": "string"
                  },
                  "mode": {
                    "enum": [
                      "ON_OFF",
                      "TRIGGER"
                    ],
                    "type": "string"
                  },
                  "offValue": {
                  },
                  "onValue": {
                  },
                  "pin": {
                    "type": "number"
                  },
                  "pull": {
                    "enum": [
                      "DOWN",
                      "UP"
                    ],
                    "type": "string"
                  },
                  "type": {
                    "enum": [
                      "GPIO"
                    ],
                    "type": "string"
                  }
                },
                "required": [
                  "pin"
                ],
                "type": "object"
              },
              {
                "type": "number"
              }
            ]
          },
          "defaultProperties": [
          ],
          "type": "object"
        },
        "lightSensor": {
          "defaultProperties": [
          ],
          "properties": {
            "address": {
              "type": "number"
            },
            "bus": {
              "type": "number"
            },
            "model": {
              "enum": [
                "ADAFRUIT_BH1750"
              ],
              "type": "string"
            },
            "transform": {
              "$ref": "#/definitions/TransformFunctionRawConfig"
            }
          },
          "required": [
            "model"
          ],
          "type": "object"
        },
        "localStatusOutputsByName": {
          "additionalProperties": {
            "anyOf": [
              {
                "defaultProperties": [
                ],
                "properties": {
                  "inverted": {
                    "type": "boolean"
                  },
                  "mode": {
                    "enum": [
                      "ON_OFF",
                      "PWM"
                    ],
                    "type": "string"
                  },
                  "pin": {
                    "type": "number"
                  },
                  "range": {
                    "type": "number"
                  }
                },
                "required": [
                  "pin"
                ],
                "type": "object"
              },
              {
                "type": "number"
              }
            ]
          },
          "defaultProperties": [
          ],
          "type": "object"
        },
        "outputsByStatus": {
          "additionalProperties": {
            "additionalProperties": {
              "anyOf": [
                {
                  "$ref": "#/definitions/TransformFunctionRawConfig"
                },
                {
                  "type": "number"
                }
              ]
            },
            "defaultProperties": [
            ],
            "type": "object"
          },
          "defaultProperties": [
          ],
          "type": "object"
        }
      },
      "type": "object"
    },
    "defaultStatus": {
      "type": "string"
    },
    "service": {
      "defaultProperties": [
      ],
      "properties": {
        "name": {
          "type": "string"
        },
        "port": {
          "type": "number"
        }
      },
      "type": "object"
    },
    "showLocalStatusOnGlobalOutput": {
      "type": "boolean"
    },
    "statuses": {
      "items": {
        "type": "string"
      },
      "type": "array"
    }
  },
  "required": [
    "box",
    "defaultStatus",
    "showLocalStatusOnGlobalOutput",
    "statuses"
  ],
  "type": "object"
};
export type ValidateFunction<T> = ((data: unknown) => data is T) & Pick<Ajv.ValidateFunction, 'errors'>
export const isRawConfig = ajv.compile(RawConfigSchema) as ValidateFunction<RawConfig>;
export default function validate(value: unknown): RawConfig {
  if (isRawConfig(value)) {
    return value;
  } else {
    throw new Error(
      ajv.errorsText(isRawConfig.errors!.filter((e: any) => e.keyword !== 'if'), {dataVar: 'RawConfig'}) +
      '\n\n' +
      inspect(value),
    );
  }
}
