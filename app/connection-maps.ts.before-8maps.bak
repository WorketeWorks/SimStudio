export type StoredConnector = {
  local: [number, number, number];
  axis: [number, number, number];
  kind: "round" | "axle" | "half";
  role: "socket" | "shaft";
  diameter: number;
  length?: number;
  rotationOnly?: boolean;
};

// Generated from the reviewed maps exported by Sim Studio's map editor.
export const preloadedConnectionMaps: Record<string, StoredConnector[]> = {
  // Differential side outputs are pin sockets. Its central axle stud is a
  // point-mounted rotating output: it cannot slide along its axis.
  "6573": [
    { local: [0, 0, -1.5], axis: [0, 0, 1], kind: "round", role: "socket", diameter: 0.8, length: 0.5 },
    { local: [0, 0, 1.5], axis: [0, 0, 1], kind: "round", role: "socket", diameter: 0.8, length: 0.5 },
    // Central axle stud: exact-point snap with rotation and no linear travel.
    { local: [0, -0.75, 0], axis: [0, 1, 0], kind: "axle", role: "shaft", diameter: 0.6, rotationOnly: true }
  ],
  "62821": [
    { local: [0, 0, -1.25], axis: [0, 0, 1], kind: "round", role: "socket", diameter: 0.8, length: 0.5 },
    { local: [0, 0, 1.25], axis: [0, 0, 1], kind: "round", role: "socket", diameter: 0.8, length: 0.5 }
  ],
  "32198": [
    {
      "local": [0, 0, 0.1],
      "axis": [0, 0, 1],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.6,
      "length": 0.5
    }
  ],
  "3649": [
    {
      "local": [0, 0, 0],
      "axis": [0, 0, 1],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.6,
      "length": 1
    }
  ],
  "2825": [
    {
      "local": [
        0,
        -0.25,
        -1
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8000000000000002
    },
    {
      "local": [
        0,
        -0.25,
        -2
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8000000000000002
    },
    {
      "local": [
        0,
        -0.25,
        0
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.24,
      "length": 0.5
    },
    {
      "local": [
        0,
        -0.25,
        -3
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.24,
      "length": 0.5
    }
  ],
  "3648": [
    {
      "local": [
        0.5,
        -0.5,
        0
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.6000000000000001
    },
    {
      "local": [
        -0.5,
        -0.5,
        0
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.6000000000000001
    },
    {
      "local": [
        -0.5,
        0.5,
        0
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.6000000000000001
    },
    {
      "local": [
        0.5,
        0.5,
        0
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.6000000000000001
    },
    {
      "local": [
        0,
        0,
        0
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.8,
      "length": 1
    }
  ],
  "3673": [
    {
      "local": [
        -0.5,
        0,
        0
      ],
      "axis": [
        1,
        0,
        0
      ],
      "kind": "round",
      "role": "shaft",
      "diameter": 0.8000000000000002,
      "length": 0.94
    },
    {
      "local": [
        0.5,
        0,
        0
      ],
      "axis": [
        1,
        0,
        0
      ],
      "kind": "round",
      "role": "shaft",
      "diameter": 0.8000000000000002,
      "length": 0.94
    }
  ],
  "3713": [
    {
      "local": [
        0,
        0,
        0
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.6000000000000001
    }
  ],
  "4185": [
    {
      "local": [
        0,
        1,
        -0.009999999999999995
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.6000000000000001
    },
    {
      "local": [
        0.8660500049591064,
        0.5148829996585846,
        -0.009999999999999995
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.5803550183773043
    },
    {
      "local": [
        -0.8660500049591064,
        0.5148829996585846,
        -0.009999999999999995
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.5803550183773043
    },
    {
      "local": [
        0.8660500049591064,
        -0.5,
        0.009999999999999995
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.5952380180358887
    },
    {
      "local": [
        0,
        -1,
        0.009999999999999995
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.6000000000000001
    },
    {
      "local": [
        -0.8660500049591064,
        -0.5,
        0.009999999999999995
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.5952380180358887
    },
    {
      "local": [
        0,
        0,
        0
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.8,
      "length": 1
    }
  ],
  "6536": [
    {
      "local": [
        0,
        0,
        0
      ],
      "axis": [
        1,
        0,
        0
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.6000000000000001
    },
    {
      "local": [
        0,
        -1,
        0
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8000000000000002,
      "length": 0.5
    }
  ],
  "6558": [
    {
      "local": [
        -1,
        0,
        0
      ],
      "axis": [
        1,
        0,
        0
      ],
      "kind": "round",
      "role": "shaft",
      "diameter": 0.8000531196594239,
      "length": 1.41
    },
    {
      "local": [
        1,
        0,
        0
      ],
      "axis": [
        1,
        0,
        0
      ],
      "kind": "round",
      "role": "shaft",
      "diameter": 0.8000531196594239,
      "length": 1.41
    },
    {
      "local": [
        0,
        0,
        0
      ],
      "axis": [
        1,
        0,
        0
      ],
      "kind": "round",
      "role": "shaft",
      "diameter": 0.8000531196594239,
      "length": 1.41
    }
  ],
  "6632": [
    {
      "local": [
        0,
        0,
        -1
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8
    },
    {
      "local": [
        0,
        0,
        0
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.24,
      "length": 0.5
    },
    {
      "local": [
        0,
        0,
        -2
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.24,
      "length": 0.5
    }
  ],
  "10197": [
    {
      "local": [
        0,
        1,
        0
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "axle",
      "role": "shaft",
      "diameter": 1.9500000000000002,
      "length": 1
    },
    {
      "local": [
        0,
        0,
        0
      ],
      "axis": [
        1,
        0,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8,
      "length": 1
    },
    {
      "local": [
        0,
        0,
        1
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "axle",
      "role": "shaft",
      "diameter": 0.8,
      "length": 1
    }
  ],
  "10928": [
    {
      "local": [
        0,
        0,
        0
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.6000000000000001
    }
  ],
  "11214": [
    {
      "local": [
        -1,
        0,
        0
      ],
      "axis": [
        1,
        0,
        0
      ],
      "kind": "round",
      "role": "shaft",
      "diameter": 0.8000000000000002,
      "length": 1.41
    },
    {
      "local": [
        1,
        0,
        0
      ],
      "axis": [
        1,
        0,
        0
      ],
      "kind": "axle",
      "role": "shaft",
      "diameter": 0.8000000000000002,
      "length": 1
    },
    {
      "local": [
        0,
        0,
        0
      ],
      "axis": [
        1,
        0,
        0
      ],
      "kind": "round",
      "role": "shaft",
      "diameter": 0.8,
      "length": 1
    }
  ],
  "11478": [
    {
      "local": [
        0,
        0,
        1
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "half",
      "role": "socket",
      "diameter": 0.8,
      "length": 0.5000000000000006
    },
    {
      "local": [
        0,
        0,
        0
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "half",
      "role": "socket",
      "diameter": 0.8,
      "length": 0.5000000000000006
    },
    {
      "local": [
        0,
        0,
        -1
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "half",
      "role": "socket",
      "diameter": 0.8,
      "length": 0.5000000000000006
    },
    {
      "local": [
        0,
        0,
        -2
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.6,
      "length": 0.5000000000000006
    },
    {
      "local": [
        0,
        0,
        2
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.6,
      "length": 0.5000000000000006
    }
  ],
  "15100": [
    {
      "local": [
        0.025,
        0,
        0
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8,
      "length": 1
    },
    {
      "local": [
        1,
        0,
        0
      ],
      "axis": [
        -1,
        0,
        0
      ],
      "kind": "round",
      "role": "shaft",
      "diameter": 0.8,
      "length": 1
    }
  ],
  "18651": [
    {
      "local": [
        -1,
        0,
        0
      ],
      "axis": [
        1,
        0,
        0
      ],
      "kind": "round",
      "role": "shaft",
      "diameter": 0.8000000000000002,
      "length": 1.41
    },
    {
      "local": [
        0.5,
        0,
        0
      ],
      "axis": [
        1,
        0,
        0
      ],
      "kind": "axle",
      "role": "shaft",
      "diameter": 0.8000000000000002,
      "length": 2
    }
  ],
  "22961": [
    {
      "local": [
        1,
        0,
        0
      ],
      "axis": [
        1,
        0,
        0
      ],
      "kind": "axle",
      "role": "shaft",
      "diameter": 0.6000000000000001,
      "length": 1
    },
    {
      "local": [
        0,
        0,
        0
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8
    }
  ],
  "26287": [
    {
      "local": [
        0,
        1.1102230246251565e-16,
        1
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.6000000000000001
    },
    {
      "local": [
        0,
        -1.1102230246251565e-16,
        -1
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.6000000000000001
    }
  ],
  "27940": [
    {
      "local": [
        1,
        0,
        0
      ],
      "axis": [
        1,
        0,
        0
      ],
      "kind": "axle",
      "role": "shaft",
      "diameter": 0.6,
      "length": 1
    },
    {
      "local": [
        -1,
        0,
        0
      ],
      "axis": [
        1,
        0,
        0
      ],
      "kind": "axle",
      "role": "shaft",
      "diameter": 0.6,
      "length": 1
    },
    {
      "local": [
        0,
        0,
        0
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8,
      "length": 1
    }
  ],
  "32013": [
    {
      "local": [
        0,
        0,
        0
      ],
      "axis": [
        1,
        0,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8
    },
    {
      "local": [
        0,
        1.1102230246251565e-16,
        1
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.6000000000000001
    }
  ],
  "32014": [
    {
      "local": [
        0,
        0,
        0
      ],
      "axis": [
        1,
        0,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8
    },
    {
      "local": [
        0,
        1,
        -1.1102230246251565e-16
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.6000000000000001
    },
    {
      "local": [
        0,
        0,
        1
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.6000000000000001
    }
  ],
  "32016": [
    {
      "local": [
        0,
        0,
        0
      ],
      "axis": [
        1,
        0,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8
    },
    {
      "local": [
        0,
        1.1102230246251565e-16,
        1
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.6000000000000001
    },
    {
      "local": [
        0,
        0.3827,
        -0.9239
      ],
      "axis": [
        0,
        0.3827103611637435,
        -0.9238683777778722
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.8,
      "length": 1
    }
  ],
  "32034": [
    {
      "local": [
        0,
        -1.1102230246251565e-16,
        -1
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.6000000000000001
    },
    {
      "local": [
        0,
        0,
        0
      ],
      "axis": [
        1,
        0,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.6000000000000001
    },
    {
      "local": [
        0,
        1.1102230246251565e-16,
        1
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.6000000000000001
    }
  ],
  "32054": [
    {
      "local": [
        1,
        0,
        0
      ],
      "axis": [
        1,
        0,
        0
      ],
      "kind": "round",
      "role": "shaft",
      "diameter": 0.9000000000000001,
      "length": 1.41
    },
    {
      "local": [
        -1,
        0,
        0
      ],
      "axis": [
        1,
        0,
        0
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.24,
      "length": 0.5
    },
    {
      "local": [
        0,
        0,
        0
      ],
      "axis": [
        1,
        0,
        0
      ],
      "kind": "round",
      "role": "shaft",
      "diameter": 0.24,
      "length": 0.5
    }
  ],
  "32056": [
    {
      "local": [
        1,
        0,
        0
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.7089799970388413
    },
    {
      "local": [
        0,
        0,
        -1
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8
    },
    {
      "local": [
        0,
        0,
        0
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.8,
      "length": 1
    },
    {
      "local": [
        2,
        0,
        0
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.8,
      "length": 1
    },
    {
      "local": [
        0,
        0,
        -2
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.8,
      "length": 1
    }
  ],
  "32062": [
    {
      "local": [
        0,
        0,
        0
      ],
      "axis": [
        1,
        0,
        0
      ],
      "kind": "axle",
      "role": "shaft",
      "diameter": 0.6000000000000002,
      "length": 2
    }
  ],
  "32063": [
    {
      "local": [
        0,
        0.010000000000000009,
        0.5
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8
    },
    {
      "local": [
        0,
        0.010000000000000009,
        1.5
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8
    },
    {
      "local": [
        0,
        0.010000000000000009,
        2.5
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8000000000000002
    },
    {
      "local": [
        0,
        -0.010000000000000009,
        -2.5
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8000000000000002
    },
    {
      "local": [
        0,
        -0.010000000000000009,
        -1.5
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8
    },
    {
      "local": [
        0,
        0.039999999999999994,
        -0.5076099991798402
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.7923900008201599
    }
  ],
  "32065": [
    {
      "local": [
        0,
        0,
        0
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.7089799970388413
    },
    {
      "local": [
        0,
        0.010000000000000009,
        1
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8
    },
    {
      "local": [
        0,
        0.010000000000000009,
        2
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8000000000000002
    },
    {
      "local": [
        0,
        0.010000000000000009,
        3
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8000000000000002
    },
    {
      "local": [
        0,
        -0.010000000000000009,
        -3
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8000000000000002
    },
    {
      "local": [
        0,
        -0.010000000000000009,
        -2
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8000000000000002
    },
    {
      "local": [
        0,
        -0.010000000000000009,
        -1
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8
    }
  ],
  "32140": [
    {
      "local": [
        0,
        0,
        -1
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8
    },
    {
      "local": [
        0,
        0,
        -2
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8000000000000002
    },
    {
      "local": [
        0,
        0,
        -3
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8000000000000002
    },
    {
      "local": [
        1,
        0,
        -3
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8000000000000002
    },
    {
      "local": [
        0,
        0,
        0
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.8,
      "length": 1
    }
  ],
  "32184": [
    {
      "local": [
        0,
        1,
        -1.1102230246251565e-16
      ],
      "axis": [
        1,
        0,
        0
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.6000000000000001
    },
    {
      "local": [
        0,
        -1,
        1.1102230246251565e-16
      ],
      "axis": [
        1,
        0,
        0
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.6000000000000001
    },
    {
      "local": [
        0,
        0,
        0
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8
    }
  ],
  "32192": [
    {
      "local": [
        0,
        1.1102230246251565e-16,
        1
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.6000000000000001
    },
    {
      "local": [
        0,
        0,
        0
      ],
      "axis": [
        1,
        0,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8,
      "length": 1
    },
    {
      "local": [
        0,
        0.707107,
        -0.707107
      ],
      "axis": [
        0,
        0.7070651705941915,
        -0.7071483893304197
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.8,
      "length": 1
    }
  ],
  "32269": [
    {
      "local": [
        0,
        0,
        0
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.8,
      "length": 1
    }
  ],
  "32270": [
    {
      "local": [
        0,
        0,
        0
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.6000000000000001
    }
  ],
  "32271": [
    {
      "local": [
        0,
        0,
        -1
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8000000000000002
    },
    {
      "local": [
        0,
        0,
        -2
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8000000000000002
    },
    {
      "local": [
        0,
        0,
        -3
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8000000000000002
    },
    {
      "local": [
        0,
        0,
        -4
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8000000000000002
    },
    {
      "local": [
        0,
        0,
        -5
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.7999999999999999
    },
    {
      "local": [
        0,
        0,
        -6
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.7999999999999999
    },
    {
      "local": [
        0,
        0,
        0
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.8,
      "length": 1
    },
    {
      "local": [
        0.8,
        0,
        -6.6
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8,
      "length": 1
    },
    {
      "local": [
        1.6,
        0,
        -7.2
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.8,
      "length": 1
    }
  ],
  "32291": [
    {
      "local": [
        0,
        0,
        0
      ],
      "axis": [
        1,
        0,
        0
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.6000000000000001
    },
    {
      "local": [
        0.5,
        -1,
        0
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8000000000000002
    },
    {
      "local": [
        -0.5,
        -1,
        0
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8000000000000002
    }
  ],
  "32449": [
    {
      "local": [
        0,
        0,
        0.5
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8
    },
    {
      "local": [
        0,
        0,
        -0.5
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8
    },
    {
      "local": [
        0,
        0,
        -1.5
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.24,
      "length": 0.5
    },
    {
      "local": [
        0,
        0,
        1.5
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.24,
      "length": 0.5
    }
  ],
  "32498": [
    {
      "local": [
        1,
        0,
        0
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8,
      "length": 1.0000000000000007
    },
    {
      "local": [
        -1,
        0,
        0
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8,
      "length": 1.0000000000000007
    },
    {
      "local": [
        0,
        -1,
        0
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.6,
      "length": 1.0000000000000007
    },
    {
      "local": [
        0,
        0,
        0
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.6,
      "length": 1.0000000000000007
    },
    {
      "local": [
        0,
        1,
        0
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.6,
      "length": 1.0000000000000007
    }
  ],
  "41677": [
    {
      "local": [
        0,
        0,
        -1
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.8,
      "length": 0.5
    },
    {
      "local": [
        0,
        0,
        0
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.8,
      "length": 0.5
    }
  ],
  "41678": [
    {
      "local": [
        -0.75,
        0,
        0
      ],
      "axis": [
        1,
        0,
        0
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.6394999980926515
    },
    {
      "local": [
        0.75,
        0,
        0
      ],
      "axis": [
        1,
        0,
        0
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.6394999980926515
    },
    {
      "local": [
        -0.5,
        0,
        1
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8
    },
    {
      "local": [
        0.5,
        0,
        1
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8
    }
  ],
  "42003": [
    {
      "local": [
        0,
        1,
        -1.1102230246251565e-16
      ],
      "axis": [
        1,
        0,
        0
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.6000000000000001
    },
    {
      "local": [
        0,
        0,
        0
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8
    },
    {
      "local": [
        0,
        -1,
        0
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8
    }
  ],
  "46372": [
    {
      "local": [
        0,
        0,
        0
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.7000000000000001
    },
    {
      "local": [
        0,
        -1,
        0
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8000000000000002
    },
    {
      "local": [
        1,
        0,
        0
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8
    },
    {
      "local": [
        0,
        1,
        0
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8
    },
    {
      "local": [
        -1,
        0,
        0
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8
    }
  ],
  "48989": [
    {
      "local": [
        0,
        1,
        0
      ],
      "axis": [
        1,
        0,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8,
      "length": 1
    },
    {
      "local": [
        0,
        -1,
        0
      ],
      "axis": [
        1,
        0,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8,
      "length": 1
    },
    {
      "local": [
        0,
        0,
        0
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8
    },
    {
      "local": [
        0,
        1,
        1
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "round",
      "role": "shaft",
      "diameter": 0.8,
      "length": 1
    },
    {
      "local": [
        0,
        -1,
        1
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "round",
      "role": "shaft",
      "diameter": 0.8,
      "length": 1
    },
    {
      "local": [
        0,
        1,
        -1
      ],
      "axis": [
        0,
        0,
        -1
      ],
      "kind": "round",
      "role": "shaft",
      "diameter": 0.8,
      "length": 1
    },
    {
      "local": [
        0,
        -1,
        -1
      ],
      "axis": [
        0,
        0,
        -1
      ],
      "kind": "round",
      "role": "shaft",
      "diameter": 0.8,
      "length": 1
    }
  ],
  "55615": [
    {
      "local": [
        0,
        0,
        0
      ],
      "axis": [
        1,
        0,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8,
      "length": 1
    },
    {
      "local": [
        0,
        2,
        0
      ],
      "axis": [
        1,
        0,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8,
      "length": 1
    },
    {
      "local": [
        0,
        1,
        0
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8,
      "length": 1
    },
    {
      "local": [
        0,
        2,
        0
      ],
      "axis": [
        1,
        0,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8,
      "length": 1
    },
    {
      "local": [
        0,
        0,
        -2
      ],
      "axis": [
        1,
        0,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8,
      "length": 1
    },
    {
      "local": [
        0,
        0,
        -1
      ],
      "axis": [
        0,
        -1,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8,
      "length": 1
    },
    {
      "local": [
        0,
        2,
        1
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "round",
      "role": "shaft",
      "diameter": 0.8,
      "length": 1
    },
    {
      "local": [
        0,
        0,
        1
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "round",
      "role": "shaft",
      "diameter": 0.8,
      "length": 1
    },
    {
      "local": [
        0,
        -1,
        0
      ],
      "axis": [
        0,
        -1,
        0
      ],
      "kind": "round",
      "role": "shaft",
      "diameter": 0.8,
      "length": 1
    },
    {
      "local": [
        0,
        -1,
        -2
      ],
      "axis": [
        0,
        -1,
        0
      ],
      "kind": "round",
      "role": "shaft",
      "diameter": 0.8,
      "length": 1
    }
  ],
  "60483": [
    {
      "local": [
        0,
        0,
        -1
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8000000000000002
    },
    {
      "local": [
        0,
        0,
        0
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.24,
      "length": 0.5
    }
  ],
  "87082": [
    {
      "local": [
        -1,
        0,
        0
      ],
      "axis": [
        -1,
        0,
        0
      ],
      "kind": "round",
      "role": "shaft",
      "diameter": 0.8,
      "length": 1
    },
    {
      "local": [
        1,
        0,
        0
      ],
      "axis": [
        -1,
        0,
        0
      ],
      "kind": "round",
      "role": "shaft",
      "diameter": 0.8,
      "length": 1
    },
    {
      "local": [
        0,
        0,
        0
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8,
      "length": 1
    }
  ],
  "87408": [
    {
      "local": [
        0,
        0.5,
        -5.551115123125783e-17
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8
    },
    {
      "local": [
        0,
        2.5,
        -1.25
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.6000000000000001
    },
    {
      "local": [
        0,
        1.5,
        -1.25
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.6
    },
    {
      "local": [
        0,
        2.5,
        1.25
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.6000000000000001
    },
    {
      "local": [
        0,
        1.5000000000000004,
        1.25
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.6
    },
    {
      "local": [
        0,
        0.5,
        -1
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.8,
      "length": 1
    },
    {
      "local": [
        0,
        0.5,
        1
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.8,
      "length": 1
    }
  ],
  "92907": [
    {
      "local": [
        0.75,
        -1,
        0
      ],
      "axis": [
        1,
        0,
        0
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.6499449968338014
    },
    {
      "local": [
        0.75,
        -0.9999999999999999,
        1
      ],
      "axis": [
        1,
        0,
        0
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.6499449968338012
    },
    {
      "local": [
        -0.75,
        -1,
        0
      ],
      "axis": [
        1,
        0,
        0
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.6499449968338014
    },
    {
      "local": [
        -0.75,
        -0.9999999999999999,
        1
      ],
      "axis": [
        1,
        0,
        0
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.6499449968338012
    },
    {
      "local": [
        0,
        0,
        0
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "round",
      "role": "socket",
      "diameter": 0.8
    }
  ],
  "99773": [
    {
      "local": [
        0,
        0,
        0
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "half",
      "role": "socket",
      "diameter": 0.7089799970388413
    },
    {
      "local": [
        -1,
        0,
        0
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "half",
      "role": "socket",
      "diameter": 0.7089799970388413
    },
    {
      "local": [
        1,
        0,
        0
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "half",
      "role": "socket",
      "diameter": 0.7089799970388413
    },
    {
      "local": [
        0,
        0,
        -1
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "half",
      "role": "socket",
      "diameter": 0.8
    },
    {
      "local": [
        0,
        0,
        -2
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "half",
      "role": "socket",
      "diameter": 0.8000000000000002
    },
    {
      "local": [
        -2,
        0,
        0
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.8,
      "length": 1
    },
    {
      "local": [
        2,
        0,
        0
      ],
      "axis": [
        0,
        1,
        0
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.8,
      "length": 1
    }
  ],
  "4265c": [
    {
      "local": [
        0,
        0,
        0
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.6325250029563905
    }
  ],
  "6538c": [
    {
      "local": [
        0,
        5.551115123125783e-17,
        0.51
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.6000000000000001
    },
    {
      "local": [
        0,
        -5.551115123125783e-17,
        -0.49
      ],
      "axis": [
        0,
        0,
        1
      ],
      "kind": "axle",
      "role": "socket",
      "diameter": 0.6000000000000001
    }
  ]
};
