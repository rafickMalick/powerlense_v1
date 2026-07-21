import os

structure = {
    "src/config": [
        "database.config.ts",
        "mqtt.config.ts",
        "app.config.ts"
    ],
    "src/database/entities": [
        "room.entity.ts",
        "circuit.entity.ts",
        "channel.entity.ts",
        "energy-measurement.entity.ts",
        "audit-log.entity.ts"
    ],
    "src/database/migrations": [],
    "src/database/seeders": [
        "mvp.seeder.ts"
    ],
    "src/modules/rooms/dto": [
        "update-room.dto.ts",
        "room-response.dto.ts"
    ],
    "src/modules/rooms": [
        "rooms.controller.ts",
        "rooms.service.ts",
        "rooms.module.ts"
    ],
    "src/modules/circuits/dto": [
        "update-circuit.dto.ts",
        "circuit-response.dto.ts"
    ],
    "src/modules/circuits": [
        "circuits.controller.ts",
        "circuits.service.ts",
        "circuits.module.ts"
    ],
    "src/modules/channels": [
        "channels.service.ts",
        "channels.module.ts"
    ],
    "src/modules/measurements": [
        "measurements.service.ts",
        "measurements.module.ts"
    ],
    "src/modules/mqtt": [
        "mqtt.service.ts",
        "mqtt.module.ts"
    ],
    "src/modules/commands": [
        "command.service.ts",
        "command.module.ts"
    ],
    "src/common/enums": [
        "circuit-status.enum.ts",
        "channel-type.enum.ts"
    ],
    "src/docs": [
        "mqtt-contract.md",
        "api-endpoints.md",
        "architecture.md"
    ]
}

for path, files in structure.items():
    os.makedirs(path, exist_ok=True)
    for file in files:
        full_path = os.path.join(path, file)
        if not os.path.exists(full_path):
            with open(full_path, "w") as f:
                f.write("")
print(" PowerLens backend structure created.")
