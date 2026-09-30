/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/stillpaid.json`.
 */
export type Stillpaid = {
  "address": "2gbyeNrQm2869HMK2mnSJyHc4cQfDrAGh6dk5ccoVyg4",
  "metadata": {
    "name": "stillpaid",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Stillpaid: milestone escrow where silence means approval"
  },
  "instructions": [
    {
      "name": "acceptJob",
      "discriminator": [
        43,
        201,
        124,
        1,
        19,
        189,
        96,
        10
      ],
      "accounts": [
        {
          "name": "freelancer",
          "signer": true,
          "relations": [
            "job"
          ]
        },
        {
          "name": "job",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "acceptSplit",
      "docs": [
        "The other side accepts the standing offer. `freelancer_bps` must match it,",
        "so a last-second change of the offer cannot be accepted by accident."
      ],
      "discriminator": [
        177,
        172,
        17,
        93,
        193,
        86,
        54,
        222
      ],
      "accounts": [
        {
          "name": "actor",
          "signer": true
        },
        {
          "name": "job",
          "relations": [
            "milestone"
          ]
        },
        {
          "name": "milestone",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  108,
                  101,
                  115,
                  116,
                  111,
                  110,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "job"
              },
              {
                "kind": "account",
                "path": "milestone.index",
                "account": "milestone"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "job"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "milestone"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "freelancerToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "job.freelancer",
                "account": "job"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "clientToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "job.client",
                "account": "job"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "freelancerBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "addMilestone",
      "discriminator": [
        165,
        18,
        177,
        128,
        204,
        172,
        23,
        249
      ],
      "accounts": [
        {
          "name": "client",
          "signer": true,
          "relations": [
            "job"
          ]
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "job",
          "writable": true
        },
        {
          "name": "milestone",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  108,
                  101,
                  115,
                  116,
                  111,
                  110,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "job"
              },
              {
                "kind": "account",
                "path": "job.milestone_count",
                "account": "job"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "job"
          ]
        },
        {
          "name": "clientToken",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "milestone"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "deliveryDeadline",
          "type": "i64"
        },
        {
          "name": "title",
          "type": "string"
        }
      ]
    },
    {
      "name": "approve",
      "discriminator": [
        69,
        74,
        217,
        36,
        115,
        117,
        97,
        76
      ],
      "accounts": [
        {
          "name": "actor",
          "signer": true
        },
        {
          "name": "job",
          "relations": [
            "milestone"
          ]
        },
        {
          "name": "milestone",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  108,
                  101,
                  115,
                  116,
                  111,
                  110,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "job"
              },
              {
                "kind": "account",
                "path": "milestone.index",
                "account": "milestone"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "job"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "milestone"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "freelancerToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "job.freelancer",
                "account": "job"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "clientToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "job.client",
                "account": "job"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "closeJob",
      "docs": [
        "Once every milestone is closed, the job's rent goes back as well."
      ],
      "discriminator": [
        90,
        100,
        180,
        200,
        200,
        163,
        120,
        182
      ],
      "accounts": [
        {
          "name": "job",
          "writable": true
        },
        {
          "name": "rentPayer",
          "docs": [
            "Only whoever paid the rent may close, so nobody else can erase a settled record."
          ],
          "writable": true,
          "signer": true,
          "relations": [
            "job"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "closeMilestone",
      "docs": [
        "Returns the rent of a settled milestone and its vault to whoever paid it.",
        "Tokens sent to the vault after settlement go to the client first."
      ],
      "discriminator": [
        64,
        73,
        247,
        200,
        45,
        76,
        197,
        241
      ],
      "accounts": [
        {
          "name": "job",
          "writable": true,
          "relations": [
            "milestone"
          ]
        },
        {
          "name": "milestone",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  108,
                  101,
                  115,
                  116,
                  111,
                  110,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "job"
              },
              {
                "kind": "account",
                "path": "milestone.index",
                "account": "milestone"
              }
            ]
          }
        },
        {
          "name": "rentPayer",
          "docs": [
            "Only whoever paid the rent may close, so nobody else can erase a settled record."
          ],
          "writable": true,
          "signer": true,
          "relations": [
            "milestone"
          ]
        },
        {
          "name": "mint",
          "relations": [
            "job"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "milestone"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "clientToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "job.client",
                "account": "job"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "createJob",
      "discriminator": [
        178,
        130,
        217,
        110,
        100,
        27,
        82,
        119
      ],
      "accounts": [
        {
          "name": "client",
          "signer": true
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "job",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  106,
                  111,
                  98
                ]
              },
              {
                "kind": "account",
                "path": "client"
              },
              {
                "kind": "arg",
                "path": "jobId"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "tokenProgram",
          "docs": [
            "Classic SPL Token only: Token-2022 fees, hooks or delegates could drain a vault."
          ],
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "jobId",
          "type": "u64"
        },
        {
          "name": "freelancer",
          "type": "pubkey"
        },
        {
          "name": "arbiter",
          "type": "pubkey"
        },
        {
          "name": "windows",
          "type": {
            "defined": {
              "name": "windows"
            }
          }
        },
        {
          "name": "maxRevisions",
          "type": "u8"
        },
        {
          "name": "fallbackBps",
          "type": "u16"
        },
        {
          "name": "termsHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "title",
          "type": "string"
        }
      ]
    },
    {
      "name": "fallbackSplit",
      "discriminator": [
        126,
        93,
        6,
        22,
        186,
        133,
        197,
        253
      ],
      "accounts": [
        {
          "name": "actor",
          "signer": true
        },
        {
          "name": "job",
          "relations": [
            "milestone"
          ]
        },
        {
          "name": "milestone",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  108,
                  101,
                  115,
                  116,
                  111,
                  110,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "job"
              },
              {
                "kind": "account",
                "path": "milestone.index",
                "account": "milestone"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "job"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "milestone"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "freelancerToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "job.freelancer",
                "account": "job"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "clientToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "job.client",
                "account": "job"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "openDispute",
      "discriminator": [
        137,
        25,
        99,
        119,
        23,
        223,
        161,
        42
      ],
      "accounts": [
        {
          "name": "actor",
          "signer": true
        },
        {
          "name": "job",
          "relations": [
            "milestone"
          ]
        },
        {
          "name": "milestone",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  108,
                  101,
                  115,
                  116,
                  111,
                  110,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "job"
              },
              {
                "kind": "account",
                "path": "milestone.index",
                "account": "milestone"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "reasonHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "proposeSplit",
      "discriminator": [
        38,
        104,
        30,
        96,
        107,
        245,
        76,
        252
      ],
      "accounts": [
        {
          "name": "actor",
          "signer": true
        },
        {
          "name": "job",
          "relations": [
            "milestone"
          ]
        },
        {
          "name": "milestone",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  108,
                  101,
                  115,
                  116,
                  111,
                  110,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "job"
              },
              {
                "kind": "account",
                "path": "milestone.index",
                "account": "milestone"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "freelancerBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "refund",
      "discriminator": [
        2,
        96,
        183,
        251,
        63,
        208,
        46,
        46
      ],
      "accounts": [
        {
          "name": "actor",
          "signer": true
        },
        {
          "name": "job",
          "relations": [
            "milestone"
          ]
        },
        {
          "name": "milestone",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  108,
                  101,
                  115,
                  116,
                  111,
                  110,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "job"
              },
              {
                "kind": "account",
                "path": "milestone.index",
                "account": "milestone"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "job"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "milestone"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "freelancerToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "job.freelancer",
                "account": "job"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "clientToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "job.client",
                "account": "job"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "releaseOnSilence",
      "discriminator": [
        109,
        13,
        124,
        232,
        11,
        89,
        75,
        103
      ],
      "accounts": [
        {
          "name": "actor",
          "signer": true
        },
        {
          "name": "job",
          "relations": [
            "milestone"
          ]
        },
        {
          "name": "milestone",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  108,
                  101,
                  115,
                  116,
                  111,
                  110,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "job"
              },
              {
                "kind": "account",
                "path": "milestone.index",
                "account": "milestone"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "job"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "milestone"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "freelancerToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "job.freelancer",
                "account": "job"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "clientToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "job.client",
                "account": "job"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "requestRevision",
      "discriminator": [
        205,
        195,
        75,
        171,
        242,
        149,
        90,
        14
      ],
      "accounts": [
        {
          "name": "actor",
          "signer": true
        },
        {
          "name": "job",
          "relations": [
            "milestone"
          ]
        },
        {
          "name": "milestone",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  108,
                  101,
                  115,
                  116,
                  111,
                  110,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "job"
              },
              {
                "kind": "account",
                "path": "milestone.index",
                "account": "milestone"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "reasonHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "resolve",
      "discriminator": [
        246,
        150,
        236,
        206,
        108,
        63,
        58,
        10
      ],
      "accounts": [
        {
          "name": "actor",
          "signer": true
        },
        {
          "name": "job",
          "relations": [
            "milestone"
          ]
        },
        {
          "name": "milestone",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  108,
                  101,
                  115,
                  116,
                  111,
                  110,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "job"
              },
              {
                "kind": "account",
                "path": "milestone.index",
                "account": "milestone"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "job"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "milestone"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "freelancerToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "job.freelancer",
                "account": "job"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "clientToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "job.client",
                "account": "job"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "freelancerBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "submit",
      "discriminator": [
        88,
        166,
        102,
        181,
        162,
        127,
        170,
        48
      ],
      "accounts": [
        {
          "name": "actor",
          "signer": true
        },
        {
          "name": "job",
          "relations": [
            "milestone"
          ]
        },
        {
          "name": "milestone",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  108,
                  101,
                  115,
                  116,
                  111,
                  110,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "job"
              },
              {
                "kind": "account",
                "path": "milestone.index",
                "account": "milestone"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "deliverableHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "job",
      "discriminator": [
        75,
        124,
        80,
        203,
        161,
        180,
        202,
        80
      ]
    },
    {
      "name": "milestone",
      "discriminator": [
        38,
        210,
        239,
        177,
        85,
        184,
        10,
        44
      ]
    }
  ],
  "events": [
    {
      "name": "disputeOpened",
      "discriminator": [
        239,
        222,
        102,
        235,
        193,
        85,
        1,
        214
      ]
    },
    {
      "name": "jobAccepted",
      "discriminator": [
        47,
        54,
        152,
        59,
        118,
        195,
        251,
        114
      ]
    },
    {
      "name": "jobCreated",
      "discriminator": [
        48,
        110,
        162,
        177,
        67,
        74,
        159,
        131
      ]
    },
    {
      "name": "milestoneFunded",
      "discriminator": [
        133,
        223,
        85,
        235,
        56,
        36,
        238,
        240
      ]
    },
    {
      "name": "paid",
      "discriminator": [
        240,
        193,
        17,
        238,
        238,
        210,
        129,
        235
      ]
    },
    {
      "name": "revisionRequested",
      "discriminator": [
        14,
        182,
        180,
        102,
        103,
        151,
        201,
        29
      ]
    },
    {
      "name": "splitProposed",
      "discriminator": [
        79,
        18,
        65,
        165,
        147,
        244,
        179,
        235
      ]
    },
    {
      "name": "submitted",
      "discriminator": [
        221,
        58,
        5,
        241,
        111,
        209,
        72,
        210
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidParties",
      "msg": "Client, freelancer and arbiter must be three different wallets"
    },
    {
      "code": 6001,
      "name": "invalidWindow",
      "msg": "A time window is shorter than this build allows or longer than 90 days"
    },
    {
      "code": 6002,
      "name": "invalidRevisions",
      "msg": "At most 10 revisions"
    },
    {
      "code": 6003,
      "name": "invalidTitle",
      "msg": "Title must be 1 to 64 bytes"
    },
    {
      "code": 6004,
      "name": "invalidAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6005,
      "name": "invalidDeadline",
      "msg": "Delivery deadline must be in the future and at most a year out"
    },
    {
      "code": 6006,
      "name": "tooManyMilestones",
      "msg": "A job can have at most 20 milestones"
    },
    {
      "code": 6007,
      "name": "alreadyAccepted",
      "msg": "The freelancer already accepted this job"
    },
    {
      "code": 6008,
      "name": "notAccepted",
      "msg": "The freelancer has not accepted this job yet"
    },
    {
      "code": 6009,
      "name": "notFreelancer",
      "msg": "Only the freelancer can do this"
    },
    {
      "code": 6010,
      "name": "notClient",
      "msg": "Only the client can do this"
    },
    {
      "code": 6011,
      "name": "notArbiter",
      "msg": "Only the arbiter can do this"
    },
    {
      "code": 6012,
      "name": "notAParty",
      "msg": "Only the client or the freelancer can do this"
    },
    {
      "code": 6013,
      "name": "wrongStatus",
      "msg": "The milestone is not in the right state for this"
    },
    {
      "code": 6014,
      "name": "deliveryLate",
      "msg": "The delivery deadline has passed"
    },
    {
      "code": 6015,
      "name": "reviewOver",
      "msg": "The review window is over; silence counts as approval"
    },
    {
      "code": 6016,
      "name": "reviewNotOver",
      "msg": "The review window is still open"
    },
    {
      "code": 6017,
      "name": "revisionsUsedUp",
      "msg": "All revisions are used up; approve or open a dispute"
    },
    {
      "code": 6018,
      "name": "invalidSplit",
      "msg": "A split is given in basis points, 0 to 10000"
    },
    {
      "code": 6019,
      "name": "noOfferFromOtherSide",
      "msg": "There is no offer from the other side to accept"
    },
    {
      "code": 6020,
      "name": "offerChanged",
      "msg": "The offer changed; reload and check it again"
    },
    {
      "code": 6021,
      "name": "noArbiter",
      "msg": "This job has no arbiter"
    },
    {
      "code": 6022,
      "name": "stillNegotiating",
      "msg": "The negotiation window is still open"
    },
    {
      "code": 6023,
      "name": "fallbackNotDue",
      "msg": "The default split is not due yet"
    },
    {
      "code": 6024,
      "name": "notLate",
      "msg": "The freelancer accepted the job and delivery is not late yet"
    },
    {
      "code": 6025,
      "name": "unsupportedMint",
      "msg": "Only classic SPL Token mints such as USDC are supported"
    },
    {
      "code": 6026,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6027,
      "name": "tooEarlyToClose",
      "msg": "A settled milestone stays on record for a while before it can be closed"
    },
    {
      "code": 6028,
      "name": "milestonesOpen",
      "msg": "Close all milestones first"
    },
    {
      "code": 6029,
      "name": "arbiterTooLate",
      "msg": "The arbiter deadline has passed; the default split applies"
    }
  ],
  "types": [
    {
      "name": "disputeOpened",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "milestone",
            "type": "pubkey"
          },
          {
            "name": "by",
            "type": {
              "defined": {
                "name": "role"
              }
            }
          },
          {
            "name": "reasonHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "negotiateDeadline",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "job",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "client",
            "type": "pubkey"
          },
          {
            "name": "freelancer",
            "type": "pubkey"
          },
          {
            "name": "arbiter",
            "docs": [
              "Pubkey::default() = no arbiter: unresolved disputes end in the default split."
            ],
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "jobId",
            "type": "u64"
          },
          {
            "name": "windows",
            "type": {
              "defined": {
                "name": "windows"
              }
            }
          },
          {
            "name": "maxRevisions",
            "type": "u8"
          },
          {
            "name": "accepted",
            "type": "bool"
          },
          {
            "name": "milestoneCount",
            "type": "u16"
          },
          {
            "name": "openMilestones",
            "type": "u16"
          },
          {
            "name": "fallbackBps",
            "docs": [
              "Freelancer's share when a dispute runs out of time, agreed up front."
            ],
            "type": "u16"
          },
          {
            "name": "rentPayer",
            "type": "pubkey"
          },
          {
            "name": "termsHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "title",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "jobAccepted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "job",
            "type": "pubkey"
          },
          {
            "name": "freelancer",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "jobCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "job",
            "type": "pubkey"
          },
          {
            "name": "client",
            "type": "pubkey"
          },
          {
            "name": "freelancer",
            "type": "pubkey"
          },
          {
            "name": "arbiter",
            "type": "pubkey"
          },
          {
            "name": "fallbackBps",
            "type": "u16"
          },
          {
            "name": "termsHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "milestone",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "job",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u16"
          },
          {
            "name": "amount",
            "docs": [
              "Amount funded; payouts use the vault balance."
            ],
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "status"
              }
            }
          },
          {
            "name": "deliveryDeadline",
            "type": "i64"
          },
          {
            "name": "reviewDeadline",
            "type": "i64"
          },
          {
            "name": "negotiateDeadline",
            "type": "i64"
          },
          {
            "name": "arbiterDeadline",
            "type": "i64"
          },
          {
            "name": "revisions",
            "type": "u8"
          },
          {
            "name": "submissions",
            "type": "u8"
          },
          {
            "name": "deliverableHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "reasonHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "disputedBy",
            "type": {
              "defined": {
                "name": "role"
              }
            }
          },
          {
            "name": "proposalBy",
            "type": {
              "defined": {
                "name": "role"
              }
            }
          },
          {
            "name": "proposalBps",
            "type": "u16"
          },
          {
            "name": "paidFreelancer",
            "type": "u64"
          },
          {
            "name": "paidClient",
            "type": "u64"
          },
          {
            "name": "settledAt",
            "type": "i64"
          },
          {
            "name": "rentPayer",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "title",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "milestoneFunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "job",
            "type": "pubkey"
          },
          {
            "name": "milestone",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u16"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "deliveryDeadline",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "outcome",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "approved"
          },
          {
            "name": "silence"
          },
          {
            "name": "agreed"
          },
          {
            "name": "arbiter"
          },
          {
            "name": "timeout"
          },
          {
            "name": "refunded"
          }
        ]
      }
    },
    {
      "name": "paid",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "milestone",
            "type": "pubkey"
          },
          {
            "name": "outcome",
            "type": {
              "defined": {
                "name": "outcome"
              }
            }
          },
          {
            "name": "toFreelancer",
            "type": "u64"
          },
          {
            "name": "toClient",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "revisionRequested",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "milestone",
            "type": "pubkey"
          },
          {
            "name": "revisions",
            "type": "u8"
          },
          {
            "name": "reasonHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "deliveryDeadline",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "role",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "none"
          },
          {
            "name": "client"
          },
          {
            "name": "freelancer"
          }
        ]
      }
    },
    {
      "name": "splitProposed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "milestone",
            "type": "pubkey"
          },
          {
            "name": "by",
            "type": {
              "defined": {
                "name": "role"
              }
            }
          },
          {
            "name": "freelancerBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "status",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "funded"
          },
          {
            "name": "submitted"
          },
          {
            "name": "disputed"
          },
          {
            "name": "released"
          },
          {
            "name": "settled"
          },
          {
            "name": "resolved"
          },
          {
            "name": "refunded"
          }
        ]
      }
    },
    {
      "name": "submitted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "milestone",
            "type": "pubkey"
          },
          {
            "name": "deliverableHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "reviewDeadline",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "windows",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "review",
            "type": "i64"
          },
          {
            "name": "fix",
            "type": "i64"
          },
          {
            "name": "negotiate",
            "type": "i64"
          },
          {
            "name": "arbiter",
            "type": "i64"
          }
        ]
      }
    }
  ]
};
