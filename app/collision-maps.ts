export type StoredCollisionPrimitive = {
  shape: "box" | "cylinder";
  center: [number, number, number];
  size?: [number, number, number];
  radius?: number;
  halfHeight?: number;
  rotation: [number, number, number, number];
  gearCollision?: boolean;
  gearRatio?: number;
};

/** Parts whose engagement must be selected by ratio-tagged collision zones. */
export const preloadedSpecialGearParts = new Set(["6573"]);

// Generated from the reviewed maps exported by Sim Studio's collider editor.
export const preloadedCollisionMaps: Record<string, StoredCollisionPrimitive[]> = {
  "6573": [
    { shape: "cylinder", center: [0, 0, -1.25], radius: 1.25, halfHeight: 0.25, rotation: [0.7071067811865475, 0, 0, 0.7071067811865476], gearCollision: true },
    { shape: "cylinder", center: [0, 0, -1.75], radius: 0.85, halfHeight: 0.25, rotation: [0.7071067811865475, 0, 0, 0.7071067811865476], gearCollision: true },
    { shape: "cylinder", center: [0, 0, -1.5], radius: 1.6, halfHeight: 0.25, rotation: [0.7071067811865475, 0, 0, 0.7071067811865476], gearCollision: false, gearRatio: 1.5 },
    { shape: "box", center: [0, 1.075, 0], size: [1, 0.15, 2], rotation: [0, 0, 0, 1], gearCollision: true },
    { shape: "box", center: [0, -1.075, 0], size: [1, 0.15, 2], rotation: [0, 0, 0, 1], gearCollision: true },
    { shape: "cylinder", center: [0, 0, 1.5], radius: 1.1, halfHeight: 0.25, rotation: [0.7071067811865475, 0, 0, 0.7071067811865476], gearCollision: false, gearRatio: 1 },
    { shape: "cylinder", center: [0, 0, 1.12], radius: 1.25, halfHeight: 0.12, rotation: [0.7071067811865475, 0, 0, 0.7071067811865476], gearCollision: true },
    { shape: "cylinder", center: [0, 0, 1.875], radius: 0.85, halfHeight: 0.125, rotation: [0.7071067811865475, 0, 0, 0.7071067811865476], gearCollision: true }
  ],
  "6589": [
    {
      "shape": "cylinder",
      "center": [0, 0, -0.1],
      "radius": 0.6,
      "halfHeight": 0.25,
      "rotation": [0.7071067811865475, 0, 0, 0.7071067811865476]
    },
    {
      "shape": "cylinder",
      "center": [0, 0, -0.175],
      "radius": 0.8,
      "halfHeight": 0.175,
      "rotation": [0.7071067811865475, 0, 0, 0.7071067811865476]
    }
  ],
  "3648": [
    {
      "shape": "cylinder",
      "center": [0, 0, 0],
      "radius": 1.6,
      "halfHeight": 0.25,
      "rotation": [0.7071067811865475, 0, 0, 0.7071067811865476]
    },
    {
      "shape": "cylinder",
      "center": [0, 0, 0],
      "radius": 0.45,
      "halfHeight": 0.48,
      "rotation": [0.7071067811865475, 0, 0, 0.7071067811865476]
    }
  ],
  "46372": [
    {
      "shape": "cylinder",
      "center": [0, 0, 0],
      "radius": 1.85,
      "halfHeight": 0.5,
      "rotation": [0.7071067811865475, 0, 0, 0.7071067811865475]
    }
  ],
  "32198": [
    {
      "shape": "cylinder",
      "center": [0, 0, 0.175],
      "radius": 1.3,
      "halfHeight": 0.175,
      "rotation": [0.7071067811865475, 0, 0, 0.7071067811865475]
    },
    {
      "shape": "cylinder",
      "center": [0, 0, 0],
      "radius": 0.6,
      "halfHeight": 0.15,
      "rotation": [0.7071067811865475, 0, 0, 0.7071067811865476]
    }
  ],
  "32270": [
    {
      "shape": "cylinder",
      "center": [0, 0, 0],
      "radius": 0.85,
      "halfHeight": 0.5,
      "rotation": [0.7071067811865475, 0, 0, 0.7071067811865475]
    }
  ],
  "32269": [
    {
      "shape": "cylinder",
      "center": [0, 0, 0],
      "radius": 1.35,
      "halfHeight": 0.5,
      "rotation": [0.7071067811865475, 0, 0, 0.7071067811865475]
    }
  ],
  "2825": [
    {
      "shape": "box",
      "center": [
        0,
        -0.25,
        -1.5
      ],
      "size": [
        3,
        0.5,
        0.9
      ],
      "rotation": [
        0,
        -0.7071067811865475,
        0,
        0.7071067811865476
      ]
    },
    {
      "shape": "cylinder",
      "center": [
        0,
        -0.25,
        -3
      ],
      "radius": 0.45,
      "halfHeight": 0.25,
      "rotation": [
        0,
        0,
        0,
        1
      ]
    },
    {
      "shape": "cylinder",
      "center": [
        0,
        0,
        0
      ],
      "radius": 0.45,
      "halfHeight": 0.5,
      "rotation": [
        0,
        0,
        0,
        1
      ]
    }
  ],
  "3713": [
    {
      "shape": "cylinder",
      "center": [
        0,
        0,
        0
      ],
      "radius": 0.46,
      "halfHeight": 0.5,
      "rotation": [
        -0.4999999999999999,
        0.5,
        -0.5,
        0.5000000000000001
      ]
    }
  ],
  "18654": [
    {
      "shape": "cylinder",
      "center": [
        0,
        0,
        0
      ],
      "radius": 0.45,
      "halfHeight": 0.5,
      "rotation": [
        0,
        0,
        0,
        1
      ]
    }
  ],
  "32013": [
    {
      "shape": "cylinder",
      "center": [
        0,
        0,
        0
      ],
      "radius": 0.45,
      "halfHeight": 0.5,
      "rotation": [
        0,
        0,
        -0.7071067811865475,
        0.7071067811865476
      ]
    },
    {
      "shape": "cylinder",
      "center": [
        0,
        0,
        0.75
      ],
      "radius": 0.45,
      "halfHeight": 0.75,
      "rotation": [
        0.7071067811865475,
        0,
        0,
        0.7071067811865476
      ]
    }
  ],
  "32016": [
    {
      "shape": "cylinder",
      "center": [
        0,
        0.28701,
        -0.69291
      ],
      "radius": 0.45,
      "halfHeight": 0.75,
      "rotation": [
        -0.5555702330196022,
        0,
        0,
        0.8314696123025452
      ]
    },
    {
      "shape": "cylinder",
      "center": [
        0,
        0,
        0
      ],
      "radius": 0.45,
      "halfHeight": 0.5,
      "rotation": [
        0,
        0,
        0.7071067811865475,
        0.7071067811865476
      ]
    },
    {
      "shape": "cylinder",
      "center": [
        0,
        0,
        0.75
      ],
      "radius": 0.45,
      "halfHeight": 0.75,
      "rotation": [
        0.7071067811865475,
        0,
        0,
        0.7071067811865476
      ]
    }
  ],
  "32034": [
    {
      "shape": "cylinder",
      "center": [
        0,
        0,
        0
      ],
      "radius": 0.45,
      "halfHeight": 0.5,
      "rotation": [
        0,
        0,
        0.7071067811865475,
        0.7071067811865476
      ]
    },
    {
      "shape": "cylinder",
      "center": [
        0,
        0,
        0
      ],
      "radius": 0.45,
      "halfHeight": 1.5,
      "rotation": [
        0.7071067811865475,
        0,
        0,
        0.7071067811865476
      ]
    }
  ],
  "32062": [
    {
      "shape": "box",
      "center": [
        0,
        0,
        0
      ],
      "size": [
        1,
        0.2,
        0.6
      ],
      "rotation": [
        0,
        0,
        0,
        1
      ]
    },
    {
      "shape": "box",
      "center": [
        0,
        0,
        0
      ],
      "size": [
        1,
        0.6,
        0.2
      ],
      "rotation": [
        0,
        0,
        0,
        1
      ]
    }
  ],
  "32184": [
    {
      "shape": "box",
      "center": [
        0,
        0,
        0
      ],
      "size": [
        0.9,
        2,
        0.9
      ],
      "rotation": [
        0,
        0,
        0,
        1
      ]
    },
    {
      "shape": "cylinder",
      "center": [
        0,
        0,
        0
      ],
      "radius": 0.45,
      "halfHeight": 0.5,
      "rotation": [
        0.7071067811865475,
        0,
        0,
        0.7071067811865476
      ]
    },
    {
      "shape": "cylinder",
      "center": [
        0,
        1,
        0
      ],
      "radius": 0.45,
      "halfHeight": 0.5,
      "rotation": [
        0,
        0,
        0.7071067811865475,
        0.7071067811865476
      ]
    },
    {
      "shape": "cylinder",
      "center": [
        0,
        -1,
        0
      ],
      "radius": 0.45,
      "halfHeight": 0.5,
      "rotation": [
        0,
        0,
        0.7071067811865475,
        0.7071067811865476
      ]
    }
  ],
  "32192": [
    {
      "shape": "cylinder",
      "center": [
        0,
        0,
        0
      ],
      "radius": 0.5,
      "halfHeight": 0.45,
      "rotation": [
        0,
        0,
        0.7071067811865475,
        0.7071067811865476
      ]
    },
    {
      "shape": "cylinder",
      "center": [
        0,
        0,
        0.75
      ],
      "radius": 0.45,
      "halfHeight": 0.75,
      "rotation": [
        0.7071067811865475,
        0,
        0,
        0.7071067811865476
      ]
    },
    {
      "shape": "cylinder",
      "center": [
        0,
        0.53033,
        -0.5303
      ],
      "radius": 0.5,
      "halfHeight": 0.75,
      "rotation": [
        -0.3826834323650898,
        0,
        0,
        0.9238795325112867
      ]
    }
  ],
  "32271": [
    {
      "shape": "box",
      "center": [
        0,
        0,
        -3
      ],
      "size": [
        6,
        1,
        0.9
      ],
      "rotation": [
        0,
        -0.7071067811865475,
        0,
        0.7071067811865476
      ]
    },
    {
      "shape": "box",
      "center": [
        0.8000000000000003,
        0,
        -6.6
      ],
      "size": [
        2,
        1,
        0.9
      ],
      "rotation": [
        0,
        0.31622776601683794,
        0,
        0.948683298050514
      ]
    },
    {
      "shape": "cylinder",
      "center": [
        0,
        0,
        -6
      ],
      "radius": 0.45,
      "halfHeight": 0.5,
      "rotation": [
        0,
        0,
        0,
        1
      ]
    },
    {
      "shape": "cylinder",
      "center": [
        0,
        0,
        0
      ],
      "radius": 0.45,
      "halfHeight": 0.5,
      "rotation": [
        0,
        0,
        0,
        1
      ]
    },
    {
      "shape": "cylinder",
      "center": [
        1.6,
        0,
        -7.2
      ],
      "radius": 0.45,
      "halfHeight": 0.5,
      "rotation": [
        0,
        0,
        0,
        1
      ]
    }
  ],
  "45590": [
    {
      "shape": "cylinder",
      "center": [
        0,
        0,
        0
      ],
      "radius": 0.45,
      "halfHeight": 0.5,
      "rotation": [
        -0.7071067811865475,
        0,
        0,
        0.7071067811865476
      ]
    },
    {
      "shape": "cylinder",
      "center": [
        1,
        0,
        0
      ],
      "radius": 0.45,
      "halfHeight": 0.5,
      "rotation": [
        -0.7071067811865475,
        0,
        0,
        0.7071067811865476
      ]
    }
  ],
  "55615": [
    {
      "shape": "cylinder",
      "center": [
        0,
        0,
        1
      ],
      "radius": 0.3,
      "halfHeight": 0.5,
      "rotation": [
        0.7071067811865475,
        0,
        0,
        0.7071067811865476
      ]
    },
    {
      "shape": "cylinder",
      "center": [
        0,
        2,
        1
      ],
      "radius": 0.3,
      "halfHeight": 0.5,
      "rotation": [
        0.7071067811865475,
        0,
        0,
        0.7071067811865476
      ]
    },
    {
      "shape": "cylinder",
      "center": [
        0,
        -1,
        0
      ],
      "radius": 0.3,
      "halfHeight": 0.5,
      "rotation": [
        0,
        0,
        0,
        1
      ]
    },
    {
      "shape": "cylinder",
      "center": [
        0,
        -1,
        -2
      ],
      "radius": 0.3,
      "halfHeight": 0.5,
      "rotation": [
        0,
        0,
        0,
        1
      ]
    },
    {
      "shape": "box",
      "center": [
        0,
        0.75,
        0.025
      ],
      "size": [
        0.9,
        2.5,
        0.95
      ],
      "rotation": [
        0,
        0,
        0,
        1
      ]
    },
    {
      "shape": "cylinder",
      "center": [
        0,
        2,
        0.25
      ],
      "radius": 0.45,
      "halfHeight": 0.25,
      "rotation": [
        0.7071067811865475,
        0,
        0,
        0.7071067811865476
      ]
    },
    {
      "shape": "cylinder",
      "center": [
        0,
        0,
        0
      ],
      "radius": 0.45,
      "halfHeight": 0.5,
      "rotation": [
        0,
        0,
        0.7071067811865475,
        0.7071067811865476
      ]
    },
    {
      "shape": "cylinder",
      "center": [
        0,
        2,
        0
      ],
      "radius": 0.45,
      "halfHeight": 0.5,
      "rotation": [
        0,
        0,
        0.7071067811865475,
        0.7071067811865476
      ]
    },
    {
      "shape": "box",
      "center": [
        0,
        -0.025,
        -0.75
      ],
      "size": [
        0.9,
        0.95,
        2.5
      ],
      "rotation": [
        0,
        0,
        0,
        1
      ]
    },
    {
      "shape": "cylinder",
      "center": [
        0,
        0,
        -2
      ],
      "radius": 0.45,
      "halfHeight": 0.5,
      "rotation": [
        0,
        0,
        0.7071067811865475,
        0.7071067811865476
      ]
    }
  ],
  "60484": [
    {
      "shape": "box",
      "center": [
        0,
        0,
        -1
      ],
      "size": [
        2,
        1,
        0.9
      ],
      "rotation": [
        0,
        -0.7071067811865475,
        0,
        0.7071067811865476
      ]
    },
    {
      "shape": "box",
      "center": [
        0,
        0,
        -2
      ],
      "size": [
        2,
        1,
        0.9
      ],
      "rotation": [
        0,
        0,
        0,
        1
      ]
    },
    {
      "shape": "cylinder",
      "center": [
        0,
        0,
        0
      ],
      "radius": 0.45,
      "halfHeight": 0.5,
      "rotation": [
        0,
        0,
        0,
        1
      ]
    },
    {
      "shape": "cylinder",
      "center": [
        -1,
        0,
        -2
      ],
      "radius": 0.45,
      "halfHeight": 0.5,
      "rotation": [
        0,
        0,
        0,
        1
      ]
    },
    {
      "shape": "cylinder",
      "center": [
        1,
        0,
        -2
      ],
      "radius": 0.45,
      "halfHeight": 0.5,
      "rotation": [
        0,
        0,
        0,
        1
      ]
    }
  ],
  "64179": [
    {
      "shape": "box",
      "center": [
        0,
        0,
        3
      ],
      "size": [
        4,
        0.9,
        1
      ],
      "rotation": [
        0,
        0,
        0,
        1
      ]
    },
    {
      "shape": "box",
      "center": [
        0,
        0,
        -3
      ],
      "size": [
        4,
        0.9,
        1
      ],
      "rotation": [
        0,
        0,
        0,
        1
      ]
    },
    {
      "shape": "cylinder",
      "center": [
        2,
        0,
        3
      ],
      "radius": 0.5,
      "halfHeight": 0.5,
      "rotation": [
        0,
        0,
        0,
        1
      ]
    },
    {
      "shape": "cylinder",
      "center": [
        -2,
        0,
        3
      ],
      "radius": 0.5,
      "halfHeight": 0.5,
      "rotation": [
        0,
        0,
        0,
        1
      ]
    },
    {
      "shape": "cylinder",
      "center": [
        -2,
        0,
        -3
      ],
      "radius": 0.5,
      "halfHeight": 0.5,
      "rotation": [
        0,
        0,
        0,
        1
      ]
    },
    {
      "shape": "cylinder",
      "center": [
        2,
        0,
        -3
      ],
      "radius": 0.5,
      "halfHeight": 0.5,
      "rotation": [
        0,
        0,
        0,
        1
      ]
    },
    {
      "shape": "box",
      "center": [
        2,
        0,
        0
      ],
      "size": [
        1,
        1,
        6
      ],
      "rotation": [
        0,
        0,
        0,
        1
      ]
    },
    {
      "shape": "box",
      "center": [
        -2,
        0,
        0
      ],
      "size": [
        1,
        1,
        6
      ],
      "rotation": [
        0,
        0,
        0,
        1
      ]
    }
  ],
  "87408": [
    {
      "shape": "box",
      "center": [
        0,
        0.5,
        -2.220446049250313e-16
      ],
      "size": [
        0.9,
        1,
        2
      ],
      "rotation": [
        0,
        0,
        0,
        1
      ]
    },
    {
      "shape": "box",
      "center": [
        0,
        1.25,
        -1.25
      ],
      "size": [
        0.9,
        2.5,
        0.5
      ],
      "rotation": [
        0,
        0,
        0,
        1
      ]
    },
    {
      "shape": "cylinder",
      "center": [
        0,
        2.5,
        -1.25
      ],
      "radius": 0.45,
      "halfHeight": 0.25,
      "rotation": [
        0.7071067811865475,
        0,
        0,
        0.7071067811865476
      ]
    },
    {
      "shape": "box",
      "center": [
        0,
        1.25,
        1.25
      ],
      "size": [
        0.9,
        2.5,
        0.5
      ],
      "rotation": [
        0,
        0,
        0,
        1
      ]
    },
    {
      "shape": "cylinder",
      "center": [
        0,
        2.5,
        1.25
      ],
      "radius": 0.45,
      "halfHeight": 0.25,
      "rotation": [
        0.7071067811865475,
        0,
        0,
        0.7071067811865476
      ]
    }
  ],
  "99773": [
    {
      "shape": "box",
      "center": [
        0,
        0,
        0
      ],
      "size": [
        4,
        0.5,
        0.9
      ],
      "rotation": [
        0,
        0,
        0,
        1
      ]
    },
    {
      "shape": "box",
      "center": [
        0,
        0,
        -1
      ],
      "size": [
        2,
        0.5,
        0.9
      ],
      "rotation": [
        0,
        -0.7071067811865475,
        0,
        0.7071067811865476
      ]
    },
    {
      "shape": "cylinder",
      "center": [
        -2,
        0,
        0
      ],
      "radius": 0.45,
      "halfHeight": 0.25,
      "rotation": [
        0,
        0,
        0,
        1
      ]
    },
    {
      "shape": "cylinder",
      "center": [
        2,
        0,
        0
      ],
      "radius": 0.45,
      "halfHeight": 0.25,
      "rotation": [
        0,
        0,
        0,
        1
      ]
    },
    {
      "shape": "cylinder",
      "center": [
        0,
        0,
        -2
      ],
      "radius": 0.45,
      "halfHeight": 0.25,
      "rotation": [
        0,
        0,
        0,
        1
      ]
    },
    {
      "shape": "cylinder",
      "center": [
        0,
        0,
        0
      ],
      "radius": 0.45,
      "halfHeight": 0.25,
      "rotation": [
        0,
        0,
        0,
        1
      ]
    },
    {
      "shape": "box",
      "center": [
        0.6,
        0,
        -0.6
      ],
      "size": [
        1.06,
        0.5,
        1.5
      ],
      "rotation": [
        0,
        0.3826834323650898,
        0,
        0.9238795325112867
      ]
    },
    {
      "shape": "box",
      "center": [
        -0.6,
        0,
        -0.6
      ],
      "size": [
        1.06,
        0.5,
        1.5
      ],
      "rotation": [
        0,
        -0.3826834323650898,
        0,
        0.9238795325112867
      ]
    }
  ],
  "4265c": [
    {
      "shape": "cylinder",
      "center": [
        0,
        0,
        0
      ],
      "radius": 0.45,
      "halfHeight": 0.25,
      "rotation": [
        0.7071067811865475,
        0,
        0,
        0.7071067811865475
      ]
    }
  ]
};

// Optional second layer used exclusively for gear-to-gear contacts.
export const preloadedGearCollisionMaps: Record<string, StoredCollisionPrimitive[]> = {
  // Physical tooth-contact envelopes. Ratio selection uses the green tagged
  // zones above; these magenta volumes continue to prevent tooth overlap.
  "6573": [
    {
      "shape": "cylinder",
      "center": [0, 0, -1.5],
      "radius": 1.3,
      "halfHeight": 0.25,
      "rotation": [0.7071067811865475, 0, 0, 0.7071067811865476]
    },
    {
      "shape": "cylinder",
      "center": [0, 0, 1.5],
      "radius": 0.8,
      "halfHeight": 0.25,
      "rotation": [0.7071067811865475, 0, 0, 0.7071067811865476]
    }
  ],
  "6589": [
    {
      "shape": "cylinder",
      "center": [0, 0, -0.1],
      "radius": 0.55,
      "halfHeight": 0.25,
      "rotation": [0.7071067811865475, 0, 0, 0.7071067811865476]
    },
    {
      "shape": "cylinder",
      "center": [0, 0, -0.05],
      "radius": 0.8,
      "halfHeight": 0.05,
      "rotation": [0.7071067811865475, 0, 0, 0.7071067811865476]
    }
  ],
  "3648": [
    {
      "shape": "cylinder",
      "center": [0, 0, 0],
      "radius": 1.3539019744873046,
      "halfHeight": 0.25,
      "rotation": [0.7071067811865475, 0, 0, 0.7071067811865475]
    }
  ],
  "46372": [
    {
      "shape": "cylinder",
      "center": [0, 0, 0],
      "radius": 1.5,
      "halfHeight": 0.5,
      "rotation": [0.7071067811865475, 0, 0, 0.7071067811865475]
    }
  ],
  "32198": [
    {
      "shape": "cylinder",
      "center": [0, 0, 0.175],
      "radius": 1,
      "halfHeight": 0.175,
      "rotation": [0.7071067811865475, 0, 0, 0.7071067811865475]
    }
  ],
  "32270": [
    {
      "shape": "cylinder",
      "center": [0, 0, 0],
      "radius": 0.5,
      "halfHeight": 0.5,
      "rotation": [0.7071067811865475, 0, 0, 0.7071067811865475]
    }
  ],
  "32269": [
    {
      "shape": "cylinder",
      "center": [0, 0, 0],
      "radius": 1,
      "halfHeight": 0.5,
      "rotation": [0.7071067811865475, 0, 0, 0.7071067811865475]
    }
  ],
  "2825": [],
  "32062": [],
  "32184": [],
  "32271": [],
  "45590": [],
  "55615": [],
  "60484": [],
  "64179": [],
  "99773": [],
  "4265c": []
};
