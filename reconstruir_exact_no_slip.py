from pathlib import Path
import shutil

ROOT = Path.cwd()
GEARS = ROOT / "physics-core" / "src" / "systems" / "gears.rs"

if not GEARS.exists():
    raise FileNotFoundError("Ejecuta este script desde la raiz de Sim Studio.")

backup = GEARS.with_suffix(GEARS.suffix + ".before-rebuild-exact-no-slip.bak")
if not backup.exists():
    shutil.copy2(GEARS, backup)

g = GEARS.read_text(encoding="utf-8")

start = g.find("fn project_one_exact_no_slip(")
end = g.find("\nfn point_impulse_denominator(", start)

if start < 0 or end < 0:
    raise RuntimeError(
        "No encuentro los limites de project_one_exact_no_slip(). "
        "No se ha modificado el archivo."
    )

new_func = r'''fn project_one_exact_no_slip(
    gear: &GearRuntime,
    world: &mut PhysicsWorld,
) {
    let (
        position_a,
        position_b,
        fixed_a,
        fixed_b,
    ) = {
        let Some(body_a) = world.bodies.get(gear.body_a) else {
            return;
        };
        let Some(body_b) = world.bodies.get(gear.body_b) else {
            return;
        };

        (
            *body_a.position(),
            *body_b.position(),
            body_a.is_fixed(),
            body_b.is_fixed(),
        )
    };

    if fixed_a && fixed_b {
        return;
    }

    let axis_a = position_a.rotation * gear.local_axis_a;
    let axis_b = position_b.rotation * gear.local_axis_b;

    let center_a = position_a.transform_point(gear.local_center_a);
    let center_b = position_b.transform_point(gear.local_center_b);
    let center_delta = center_b - center_a;

    if center_delta.length_squared() <= GEOMETRY_EPSILON {
        return;
    }

    let radial_a_raw =
        center_delta - axis_a * center_delta.dot(axis_a);
    let radial_b_raw =
        -center_delta - axis_b * (-center_delta).dot(axis_b);

    if radial_a_raw.length_squared() <= GEOMETRY_EPSILON
        || radial_b_raw.length_squared() <= GEOMETRY_EPSILON
    {
        return;
    }

    let radial_a = radial_a_raw.normalize();
    let radial_b = radial_b_raw.normalize();

    let tangent_a_raw = axis_a.cross(radial_a);
    let tangent_b_raw = axis_b.cross(radial_b);

    if tangent_a_raw.length_squared() <= GEOMETRY_EPSILON
        || tangent_b_raw.length_squared() <= GEOMETRY_EPSILON
    {
        return;
    }

    let tangent_a = tangent_a_raw.normalize();
    let mut tangent_b = tangent_b_raw.normalize();

    if tangent_a.dot(tangent_b) < 0.0 {
        tangent_b = -tangent_b;
    }

    let tangent_sum = tangent_a + tangent_b;
    let tangent =
        if tangent_sum.length_squared() > GEOMETRY_EPSILON {
            tangent_sum.normalize()
        } else {
            tangent_a
        };

    let perpendicular = axis_a.dot(axis_b).abs() < 0.2;
    let distance = center_delta.length();

    let teeth_b = gear.signed_teeth_b.abs().max(1.0);
    let total_teeth = (gear.teeth_a + teeth_b).max(1.0);

    let (radius_a, radius_b) = if perpendicular {
        (
            center_delta.dot(axis_b).abs(),
            center_delta.dot(axis_a).abs(),
        )
    } else {
        (
            distance * gear.teeth_a / total_teeth,
            distance * teeth_b / total_teeth,
        )
    };

    if radius_a <= GEOMETRY_EPSILON
        || radius_b <= GEOMETRY_EPSILON
    {
        return;
    }

    let point_a = center_a + radial_a * radius_a;
    let point_b = center_b + radial_b * radius_b;

    // IMPORTANT:
    // Both bodies are evaluated at the SAME world-space contact point.
    // Therefore a global rigid translation/rotation cancels exactly and
    // cannot be mistaken for tooth slip.
    let contact = (point_a + point_b) * 0.5;

    let (
        relative_speed,
        denominator,
    ) = {
        let Some(body_a) = world.bodies.get(gear.body_a) else {
            return;
        };
        let Some(body_b) = world.bodies.get(gear.body_b) else {
            return;
        };

        let relative_speed =
            (body_a.velocity_at_point(contact)
                - body_b.velocity_at_point(contact))
                .dot(tangent);

        let denominator =
            point_impulse_denominator(body_a, contact, tangent)
            + point_impulse_denominator(body_b, contact, tangent);

        (relative_speed, denominator)
    };

    // This function is only a hard NO-SLIP velocity constraint.
    // Do not inject phase-position error as velocity here.
    if relative_speed.abs() <= VELOCITY_EPSILON
        || denominator <= GEOMETRY_EPSILON
    {
        return;
    }

    let lambda = -relative_speed / denominator;
    let impulse = tangent * lambda;

    // Newton's third law: always equal and opposite.
    if !fixed_a {
        world.bodies[gear.body_a].apply_impulse_at_point(
            impulse,
            contact,
            true,
        );
    }

    if !fixed_b {
        world.bodies[gear.body_b].apply_impulse_at_point(
            -impulse,
            contact,
            true,
        );
    }
}
'''

g = g[:start] + new_func + g[end:]

# Keep the stabilization change even if the previous script did not reach it.
g = g.replace("    for _ in 0..24 {\n", "    for _ in 0..4 {\n", 1)

# Sanity checks.
check_start = g.find("fn project_one_exact_no_slip(")
check_end = g.find("\nfn point_impulse_denominator(", check_start)
block = g[check_start:check_end]

for token in ["point_a", "point_b", "tangent", "let contact =", "let impulse ="]:
    if token not in block:
        raise RuntimeError(f"Falta {token} dentro de project_one_exact_no_slip.")

# The malformed stray code must not remain between function and next helper.
tail = g[check_end:check_end + 80]
if "point_a" in tail or "point_b" in tail:
    raise RuntimeError("Quedo codigo spur suelto fuera de la funcion.")

GEARS.write_text(g, encoding="utf-8")

print("OK: project_one_exact_no_slip() reconstruida completa.")
print(" - point_a/point_b/tangent quedan dentro del scope correcto")
print(" - contacto mundial unico")
print(" - impulsos +J/-J")
print(" - sin phase_bias como motor")
print(" - 4 barridos exact-no-slip")
print()
print("Ahora ejecuta:")
print("  npm run physics:build")
