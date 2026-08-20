use wasm_bindgen::prelude::*;
use wgpu::util::DeviceExt;

const INSTANCE_FLOATS: usize = 20;
const MSAA_SAMPLE_COUNT: u32 = 4;

const PREPARE_INSTANCES_SHADER: &str = r#"
struct Instance {
    transform_0: vec4<f32>,
    transform_1: vec4<f32>,
    transform_2: vec4<f32>,
    transform_3: vec4<f32>,
    color_flags: vec4<f32>,
};

@group(0) @binding(0)
var<storage, read_write> instances: array<Instance>;

@compute @workgroup_size(64)
fn prepare(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= arrayLength(&instances)) { return; }
    instances[id.x].color_flags.w = max(instances[id.x].color_flags.w, 0.0);
}
"#;

const RENDER_SHADER: &str = r#"
struct Instance {
    transform_0: vec4<f32>,
    transform_1: vec4<f32>,
    transform_2: vec4<f32>,
    transform_3: vec4<f32>,
    color_flags: vec4<f32>,
};
struct Camera {
    view_projection: mat4x4<f32>,
    eye_fog_near: vec4<f32>,
    fog_color_far: vec4<f32>,
};

@group(0) @binding(0) var<storage, read> instances: array<Instance>;
@group(1) @binding(0) var<uniform> camera: Camera;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec3<f32>,
};

fn cube_vertex(index: u32) -> vec3<f32> {
    let vertices = array<vec3<f32>, 36>(
        vec3(-0.5,-0.5, 0.5), vec3( 0.5,-0.5, 0.5), vec3( 0.5, 0.5, 0.5),
        vec3(-0.5,-0.5, 0.5), vec3( 0.5, 0.5, 0.5), vec3(-0.5, 0.5, 0.5),
        vec3( 0.5,-0.5,-0.5), vec3(-0.5,-0.5,-0.5), vec3(-0.5, 0.5,-0.5),
        vec3( 0.5,-0.5,-0.5), vec3(-0.5, 0.5,-0.5), vec3( 0.5, 0.5,-0.5),
        vec3(-0.5,-0.5,-0.5), vec3(-0.5,-0.5, 0.5), vec3(-0.5, 0.5, 0.5),
        vec3(-0.5,-0.5,-0.5), vec3(-0.5, 0.5, 0.5), vec3(-0.5, 0.5,-0.5),
        vec3( 0.5,-0.5, 0.5), vec3( 0.5,-0.5,-0.5), vec3( 0.5, 0.5,-0.5),
        vec3( 0.5,-0.5, 0.5), vec3( 0.5, 0.5,-0.5), vec3( 0.5, 0.5, 0.5),
        vec3(-0.5, 0.5, 0.5), vec3( 0.5, 0.5, 0.5), vec3( 0.5, 0.5,-0.5),
        vec3(-0.5, 0.5, 0.5), vec3( 0.5, 0.5,-0.5), vec3(-0.5, 0.5,-0.5),
        vec3(-0.5,-0.5,-0.5), vec3( 0.5,-0.5,-0.5), vec3( 0.5,-0.5, 0.5),
        vec3(-0.5,-0.5,-0.5), vec3( 0.5,-0.5, 0.5), vec3(-0.5,-0.5, 0.5)
    );
    return vertices[index];
}

@vertex
fn vertex_main(
    @builtin(vertex_index) vertex_index: u32,
    @builtin(instance_index) instance_index: u32,
) -> VertexOutput {
    let item = instances[instance_index];
    let model = mat4x4<f32>(item.transform_0, item.transform_1, item.transform_2, item.transform_3);
    var output: VertexOutput;
    output.position = camera.view_projection * model * vec4(cube_vertex(vertex_index), 1.0);
    output.color = item.color_flags.rgb;
    return output;
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4<f32> {
    return vec4(input.color, 1.0);
}
"#;

const MESH_SHADER: &str = r#"
struct Instance {
    transform_0: vec4<f32>,
    transform_1: vec4<f32>,
    transform_2: vec4<f32>,
    transform_3: vec4<f32>,
    color_flags: vec4<f32>,
};
struct Camera {
    view_projection: mat4x4<f32>,
    eye_fog_near: vec4<f32>,
    fog_color_far: vec4<f32>,
};

@group(0) @binding(0) var<storage, read> instances: array<Instance>;
@group(1) @binding(0) var<uniform> camera: Camera;

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
};
struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) world_normal: vec3<f32>,
    @location(1) color: vec3<f32>,
    @location(2) selected: f32,
    @location(3) fog_distance: f32,
};

@vertex
fn vertex_main(input: VertexInput, @builtin(instance_index) instance_index: u32) -> VertexOutput {
    let item = instances[instance_index];
    let model = mat4x4<f32>(item.transform_0, item.transform_1, item.transform_2, item.transform_3);
    let world_position = model * vec4(input.position, 1.0);
    var output: VertexOutput;
    output.position = camera.view_projection * world_position;
    output.world_normal = normalize(mat3x3<f32>(model[0].xyz, model[1].xyz, model[2].xyz) * input.normal);
    output.color = item.color_flags.rgb;
    output.selected = item.color_flags.w;
    output.fog_distance = distance(world_position.xyz, camera.eye_fog_near.xyz);
    return output;
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let light_direction = normalize(vec3(0.45, 0.85, 0.35));
    let diffuse = max(dot(normalize(input.world_normal), light_direction), 0.0);
    var color = input.color * (0.34 + diffuse * 0.66);
    color = mix(color, vec3(1.0, 0.55, 0.04), clamp(input.selected, 0.0, 1.0) * 0.42);
    if (camera.fog_color_far.w > camera.eye_fog_near.w) {
        let fog = smoothstep(camera.eye_fog_near.w, camera.fog_color_far.w, input.fog_distance);
        color = mix(color, camera.fog_color_far.rgb, fog);
    }
    return vec4(pow(clamp(color, vec3(0.0), vec3(1.0)), vec3(1.0 / 2.2)), 1.0);
}
"#;

const LINE_SHADER: &str = r#"
struct Instance {
    transform_0: vec4<f32>,
    transform_1: vec4<f32>,
    transform_2: vec4<f32>,
    transform_3: vec4<f32>,
    color_flags: vec4<f32>,
};
struct Camera {
    view_projection: mat4x4<f32>,
    eye_fog_near: vec4<f32>,
    fog_color_far: vec4<f32>,
};

@group(0) @binding(0) var<storage, read> instances: array<Instance>;
@group(1) @binding(0) var<uniform> camera: Camera;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec3<f32>,
    @location(1) world_position: vec3<f32>,
};

@vertex
fn vertex_main(@location(0) position: vec3<f32>, @builtin(instance_index) instance_index: u32) -> VertexOutput {
    let item = instances[instance_index];
    let model = mat4x4<f32>(item.transform_0, item.transform_1, item.transform_2, item.transform_3);
    let world_position = model * vec4(position, 1.0);
    var output: VertexOutput;
    output.position = camera.view_projection * world_position;
    output.color = mix(item.color_flags.rgb, vec3(1.0, 0.64, 0.08), clamp(item.color_flags.w, 0.0, 1.0));
    output.world_position = world_position.xyz;
    return output;
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4<f32> {
    var color = input.color;
    if (camera.fog_color_far.w > camera.eye_fog_near.w) {
        let fog_distance = distance(input.world_position, camera.eye_fog_near.xyz);
        let fog = smoothstep(camera.eye_fog_near.w, camera.fog_color_far.w, fog_distance);
        color = mix(color, camera.fog_color_far.rgb, fog);
    }
    return vec4(pow(clamp(color, vec3(0.0), vec3(1.0)), vec3(1.0 / 2.2)), 1.0);
}
"#;

struct MeshBatch {
    vertex_buffer: wgpu::Buffer,
    index_buffer: wgpu::Buffer,
    index_count: u32,
    first_instance: u32,
    instance_count: u32,
    overlay: bool,
}

struct LineBatch {
    vertex_buffer: wgpu::Buffer,
    vertex_count: u32,
    first_instance: u32,
    instance_count: u32,
    overlay: bool,
}

fn js_error(context: &str, error: impl core::fmt::Display) -> JsValue {
    JsValue::from_str(&format!("{context}: {error}"))
}

fn multisample_state(sample_count: u32) -> wgpu::MultisampleState {
    wgpu::MultisampleState {
        count: sample_count,
        ..Default::default()
    }
}

fn create_instance_render_pipeline(
    device: &wgpu::Device,
    layout: &wgpu::PipelineLayout,
    shader: &wgpu::ShaderModule,
    format: wgpu::TextureFormat,
    sample_count: u32,
) -> wgpu::RenderPipeline {
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("Sim Studio visible instance pipeline"),
        layout: Some(layout),
        vertex: wgpu::VertexState {
            module: shader,
            entry_point: Some("vertex_main"),
            compilation_options: Default::default(),
            buffers: &[],
        },
        primitive: wgpu::PrimitiveState {
            topology: wgpu::PrimitiveTopology::TriangleList,
            cull_mode: None,
            front_face: wgpu::FrontFace::Ccw,
            ..Default::default()
        },
        depth_stencil: Some(wgpu::DepthStencilState {
            format: wgpu::TextureFormat::Depth24Plus,
            depth_write_enabled: Some(true),
            depth_compare: Some(wgpu::CompareFunction::Less),
            stencil: Default::default(),
            bias: Default::default(),
        }),
        multisample: multisample_state(sample_count),
        fragment: Some(wgpu::FragmentState {
            module: shader,
            entry_point: Some("fragment_main"),
            compilation_options: Default::default(),
            targets: &[Some(wgpu::ColorTargetState {
                format,
                blend: Some(wgpu::BlendState::REPLACE),
                write_mask: wgpu::ColorWrites::ALL,
            })],
        }),
        multiview_mask: None,
        cache: None,
    })
}

fn create_mesh_render_pipeline(
    device: &wgpu::Device,
    layout: &wgpu::PipelineLayout,
    shader: &wgpu::ShaderModule,
    format: wgpu::TextureFormat,
    sample_count: u32,
    overlay: bool,
) -> wgpu::RenderPipeline {
    let attributes = wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x3];
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("Sim Studio scene mesh pipeline"),
        layout: Some(layout),
        vertex: wgpu::VertexState {
            module: shader,
            entry_point: Some("vertex_main"),
            compilation_options: Default::default(),
            buffers: &[wgpu::VertexBufferLayout {
                array_stride: 6 * core::mem::size_of::<f32>() as u64,
                step_mode: wgpu::VertexStepMode::Vertex,
                attributes: &attributes,
            }],
        },
        primitive: wgpu::PrimitiveState {
            topology: wgpu::PrimitiveTopology::TriangleList,
            cull_mode: None,
            front_face: wgpu::FrontFace::Ccw,
            ..Default::default()
        },
        depth_stencil: Some(wgpu::DepthStencilState {
            format: wgpu::TextureFormat::Depth24Plus,
            depth_write_enabled: Some(!overlay),
            depth_compare: Some(if overlay {
                wgpu::CompareFunction::Always
            } else {
                wgpu::CompareFunction::Less
            }),
            stencil: Default::default(),
            bias: Default::default(),
        }),
        multisample: multisample_state(sample_count),
        fragment: Some(wgpu::FragmentState {
            module: shader,
            entry_point: Some("fragment_main"),
            compilation_options: Default::default(),
            targets: &[Some(wgpu::ColorTargetState {
                format,
                blend: Some(wgpu::BlendState::REPLACE),
                write_mask: wgpu::ColorWrites::ALL,
            })],
        }),
        multiview_mask: None,
        cache: None,
    })
}

fn create_line_render_pipeline(
    device: &wgpu::Device,
    layout: &wgpu::PipelineLayout,
    shader: &wgpu::ShaderModule,
    format: wgpu::TextureFormat,
    sample_count: u32,
    overlay: bool,
) -> wgpu::RenderPipeline {
    let attributes = wgpu::vertex_attr_array![0 => Float32x3];
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("Sim Studio scene line pipeline"),
        layout: Some(layout),
        vertex: wgpu::VertexState {
            module: shader,
            entry_point: Some("vertex_main"),
            compilation_options: Default::default(),
            buffers: &[wgpu::VertexBufferLayout {
                array_stride: 3 * core::mem::size_of::<f32>() as u64,
                step_mode: wgpu::VertexStepMode::Vertex,
                attributes: &attributes,
            }],
        },
        primitive: wgpu::PrimitiveState {
            topology: wgpu::PrimitiveTopology::LineList,
            cull_mode: None,
            ..Default::default()
        },
        depth_stencil: Some(wgpu::DepthStencilState {
            format: wgpu::TextureFormat::Depth24Plus,
            depth_write_enabled: Some(false),
            depth_compare: Some(if overlay {
                wgpu::CompareFunction::Always
            } else {
                wgpu::CompareFunction::LessEqual
            }),
            stencil: Default::default(),
            bias: Default::default(),
        }),
        multisample: multisample_state(sample_count),
        fragment: Some(wgpu::FragmentState {
            module: shader,
            entry_point: Some("fragment_main"),
            compilation_options: Default::default(),
            targets: &[Some(wgpu::ColorTargetState {
                format,
                blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                write_mask: wgpu::ColorWrites::ALL,
            })],
        }),
        multiview_mask: None,
        cache: None,
    })
}

#[wasm_bindgen]
pub struct RenderCore {
    adapter_name: String,
    device: wgpu::Device,
    queue: wgpu::Queue,
    pipeline: wgpu::ComputePipeline,
    compute_bind_group_layout: wgpu::BindGroupLayout,
    compute_bind_group: wgpu::BindGroup,
    render_bind_group_layout: wgpu::BindGroupLayout,
    render_bind_group: wgpu::BindGroup,
    instance_buffer: wgpu::Buffer,
    instance_capacity: usize,
    instance_count: u32,
    surface: wgpu::Surface<'static>,
    surface_config: wgpu::SurfaceConfiguration,
    render_pipeline: wgpu::RenderPipeline,
    render_pipeline_single_sample: wgpu::RenderPipeline,
    mesh_pipeline: wgpu::RenderPipeline,
    mesh_pipeline_single_sample: wgpu::RenderPipeline,
    mesh_pipeline_overlay: wgpu::RenderPipeline,
    mesh_pipeline_overlay_single_sample: wgpu::RenderPipeline,
    line_pipeline: wgpu::RenderPipeline,
    line_pipeline_single_sample: wgpu::RenderPipeline,
    line_pipeline_overlay: wgpu::RenderPipeline,
    line_pipeline_overlay_single_sample: wgpu::RenderPipeline,
    camera_buffer: wgpu::Buffer,
    camera_bind_group: wgpu::BindGroup,
    depth_texture: wgpu::Texture,
    msaa_texture: wgpu::Texture,
    msaa_samples: u32,
    mesh_batches: Vec<MeshBatch>,
    line_batches: Vec<LineBatch>,
    clear_color: wgpu::Color,
}

#[wasm_bindgen]
impl RenderCore {
    #[wasm_bindgen(js_name = create)]
    pub async fn create(canvas: web_sys::HtmlCanvasElement) -> Result<RenderCore, JsValue> {
        console_error_panic_hook::set_once();
        let mut instance_descriptor = wgpu::InstanceDescriptor::new_without_display_handle();
        instance_descriptor.backends = wgpu::Backends::BROWSER_WEBGPU;
        let instance = wgpu::Instance::new(instance_descriptor);
        let surface = instance
            .create_surface(wgpu::SurfaceTarget::Canvas(canvas.clone()))
            .map_err(|error| js_error("Could not create WebGPU canvas surface", error))?;
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                force_fallback_adapter: false,
                compatible_surface: Some(&surface),
            })
            .await
            .map_err(|error| js_error("No WebGPU adapter", error))?;
        let adapter_name = adapter.get_info().name;
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("Sim Studio render-core device"),
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::downlevel_defaults(),
                experimental_features: wgpu::ExperimentalFeatures::disabled(),
                memory_hints: wgpu::MemoryHints::Performance,
                trace: wgpu::Trace::Off,
            })
            .await
            .map_err(|error| js_error("Could not create WebGPU device", error))?;
        let compute_bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Sim Studio writable instance layout"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::COMPUTE,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Storage { read_only: false },
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
        });
        let render_bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Sim Studio read-only instance layout"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Storage { read_only: true },
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Sim Studio instance preparation"),
            source: wgpu::ShaderSource::Wgsl(PREPARE_INSTANCES_SHADER.into()),
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Sim Studio render-core pipeline layout"),
            bind_group_layouts: &[Some(&compute_bind_group_layout)],
            immediate_size: 0,
        });
        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("Sim Studio instance preparation pipeline"),
            layout: Some(&pipeline_layout),
            module: &shader,
            entry_point: Some("prepare"),
            compilation_options: Default::default(),
            cache: None,
        });
        let instance_capacity = 1;
        let instance_buffer = Self::create_instance_buffer(&device, instance_capacity);
        let compute_bind_group = Self::create_instance_bind_group(
            &device,
            &compute_bind_group_layout,
            &instance_buffer,
            "Sim Studio writable instance bind group",
        );
        let render_bind_group = Self::create_instance_bind_group(
            &device,
            &render_bind_group_layout,
            &instance_buffer,
            "Sim Studio read-only instance bind group",
        );
        let camera_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Sim Studio camera uniform"),
            size: 96,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let camera_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Sim Studio camera layout"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
        });
        let camera_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Sim Studio camera bind group"),
            layout: &camera_layout,
            entries: &[wgpu::BindGroupEntry { binding: 0, resource: camera_buffer.as_entire_binding() }],
        });
        let surface_config = surface
            .get_default_config(&adapter, canvas.width().max(1), canvas.height().max(1))
            .ok_or_else(|| JsValue::from_str("WebGPU surface has no supported configuration"))?;
        surface.configure(&device, &surface_config);
        let render_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Sim Studio visible instance shader"),
            source: wgpu::ShaderSource::Wgsl(RENDER_SHADER.into()),
        });
        let render_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Sim Studio visible render layout"),
            bind_group_layouts: &[Some(&render_bind_group_layout), Some(&camera_layout)],
            immediate_size: 0,
        });
        let render_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Sim Studio visible instance pipeline"),
            layout: Some(&render_layout),
            vertex: wgpu::VertexState {
                module: &render_shader,
                entry_point: Some("vertex_main"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                cull_mode: None,
                front_face: wgpu::FrontFace::Ccw,
                ..Default::default()
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format: wgpu::TextureFormat::Depth24Plus,
                depth_write_enabled: Some(true),
                depth_compare: Some(wgpu::CompareFunction::Less),
                stencil: Default::default(),
                bias: Default::default(),
            }),
            multisample: wgpu::MultisampleState {
                count: MSAA_SAMPLE_COUNT,
                ..Default::default()
            },
            fragment: Some(wgpu::FragmentState {
                module: &render_shader,
                entry_point: Some("fragment_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: surface_config.format,
                    blend: Some(wgpu::BlendState::REPLACE),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            multiview_mask: None,
            cache: None,
        });
        let render_pipeline_single_sample = create_instance_render_pipeline(
            &device,
            &render_layout,
            &render_shader,
            surface_config.format,
            1,
        );
        let mesh_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Sim Studio scene mesh shader"),
            source: wgpu::ShaderSource::Wgsl(MESH_SHADER.into()),
        });
        let mesh_vertex_attributes = wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x3];
        let mesh_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Sim Studio scene mesh pipeline"),
            layout: Some(&render_layout),
            vertex: wgpu::VertexState {
                module: &mesh_shader,
                entry_point: Some("vertex_main"),
                compilation_options: Default::default(),
                buffers: &[wgpu::VertexBufferLayout {
                    array_stride: 6 * core::mem::size_of::<f32>() as u64,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &mesh_vertex_attributes,
                }],
            },
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                cull_mode: None,
                front_face: wgpu::FrontFace::Ccw,
                ..Default::default()
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format: wgpu::TextureFormat::Depth24Plus,
                depth_write_enabled: Some(true),
                depth_compare: Some(wgpu::CompareFunction::Less),
                stencil: Default::default(),
                bias: Default::default(),
            }),
            multisample: wgpu::MultisampleState {
                count: MSAA_SAMPLE_COUNT,
                ..Default::default()
            },
            fragment: Some(wgpu::FragmentState {
                module: &mesh_shader,
                entry_point: Some("fragment_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: surface_config.format,
                    blend: Some(wgpu::BlendState::REPLACE),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            multiview_mask: None,
            cache: None,
        });
        let mesh_pipeline_single_sample = create_mesh_render_pipeline(
            &device,
            &render_layout,
            &mesh_shader,
            surface_config.format,
            1,
            false,
        );
        let mesh_pipeline_overlay = create_mesh_render_pipeline(
            &device,
            &render_layout,
            &mesh_shader,
            surface_config.format,
            MSAA_SAMPLE_COUNT,
            true,
        );
        let mesh_pipeline_overlay_single_sample = create_mesh_render_pipeline(
            &device,
            &render_layout,
            &mesh_shader,
            surface_config.format,
            1,
            true,
        );
        let line_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Sim Studio scene line shader"),
            source: wgpu::ShaderSource::Wgsl(LINE_SHADER.into()),
        });
        let line_vertex_attributes = wgpu::vertex_attr_array![0 => Float32x3];
        let line_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Sim Studio scene line pipeline"),
            layout: Some(&render_layout),
            vertex: wgpu::VertexState {
                module: &line_shader,
                entry_point: Some("vertex_main"),
                compilation_options: Default::default(),
                buffers: &[wgpu::VertexBufferLayout {
                    array_stride: 3 * core::mem::size_of::<f32>() as u64,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &line_vertex_attributes,
                }],
            },
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::LineList,
                cull_mode: None,
                ..Default::default()
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format: wgpu::TextureFormat::Depth24Plus,
                depth_write_enabled: Some(false),
                depth_compare: Some(wgpu::CompareFunction::LessEqual),
                stencil: Default::default(),
                bias: Default::default(),
            }),
            multisample: wgpu::MultisampleState {
                count: MSAA_SAMPLE_COUNT,
                ..Default::default()
            },
            fragment: Some(wgpu::FragmentState {
                module: &line_shader,
                entry_point: Some("fragment_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: surface_config.format,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            multiview_mask: None,
            cache: None,
        });
        let line_pipeline_single_sample = create_line_render_pipeline(
            &device,
            &render_layout,
            &line_shader,
            surface_config.format,
            1,
            false,
        );
        let line_pipeline_overlay = create_line_render_pipeline(
            &device,
            &render_layout,
            &line_shader,
            surface_config.format,
            MSAA_SAMPLE_COUNT,
            true,
        );
        let line_pipeline_overlay_single_sample = create_line_render_pipeline(
            &device,
            &render_layout,
            &line_shader,
            surface_config.format,
            1,
            true,
        );
        let depth_texture = Self::create_depth_texture(
            &device,
            surface_config.width,
            surface_config.height,
            MSAA_SAMPLE_COUNT,
        );
        let msaa_texture = Self::create_msaa_texture(
            &device,
            surface_config.width,
            surface_config.height,
            surface_config.format,
        );
        Ok(RenderCore {
            adapter_name,
            device,
            queue,
            pipeline,
            compute_bind_group_layout,
            compute_bind_group,
            render_bind_group_layout,
            render_bind_group,
            instance_buffer,
            instance_capacity,
            instance_count: 0,
            surface,
            surface_config,
            render_pipeline,
            render_pipeline_single_sample,
            mesh_pipeline,
            mesh_pipeline_single_sample,
            mesh_pipeline_overlay,
            mesh_pipeline_overlay_single_sample,
            line_pipeline,
            line_pipeline_single_sample,
            line_pipeline_overlay,
            line_pipeline_overlay_single_sample,
            camera_buffer,
            camera_bind_group,
            depth_texture,
            msaa_texture,
            msaa_samples: MSAA_SAMPLE_COUNT,
            mesh_batches: Vec::new(),
            line_batches: Vec::new(),
            clear_color: wgpu::Color { r: 0.025, g: 0.035, b: 0.065, a: 1.0 },
        })
    }

    #[wasm_bindgen(getter, js_name = adapterName)]
    pub fn adapter_name(&self) -> String { self.adapter_name.clone() }

    #[wasm_bindgen(getter, js_name = instanceCount)]
    pub fn instance_count(&self) -> u32 { self.instance_count }

    #[wasm_bindgen(getter, js_name = drawCalls)]
    pub fn draw_calls(&self) -> u32 {
        if self.mesh_batches.is_empty() && self.line_batches.is_empty() {
            u32::from(self.instance_count > 0)
        } else {
            (self.mesh_batches.len() + self.line_batches.len()).min(u32::MAX as usize) as u32
        }
    }

    #[wasm_bindgen(getter, js_name = triangleCount)]
    pub fn triangle_count(&self) -> u32 {
        if self.mesh_batches.is_empty() && self.line_batches.is_empty() {
            return self.instance_count.saturating_mul(12);
        }
        self.mesh_batches.iter().fold(0_u32, |total, batch| {
            total.saturating_add((batch.index_count / 3).saturating_mul(batch.instance_count))
        })
    }

    #[wasm_bindgen(getter, js_name = lineCount)]
    pub fn line_count(&self) -> u32 {
        self.line_batches.iter().fold(0_u32, |total, batch| {
            total.saturating_add((batch.vertex_count / 2).saturating_mul(batch.instance_count))
        })
    }

    #[wasm_bindgen(js_name = setClearColor)]
    pub fn set_clear_color(&mut self, red: f64, green: f64, blue: f64, alpha: f64) {
        self.clear_color = wgpu::Color {
            r: red.clamp(0.0, 1.0),
            g: green.clamp(0.0, 1.0),
            b: blue.clamp(0.0, 1.0),
            a: alpha.clamp(0.0, 1.0),
        };
    }

    #[wasm_bindgen(js_name = clearGeometry)]
    pub fn clear_geometry(&mut self) {
        self.mesh_batches.clear();
        self.line_batches.clear();
    }

    #[wasm_bindgen(js_name = addMesh)]
    pub fn add_mesh(
        &mut self,
        positions: &[f32],
        normals: &[f32],
        indices: &[u32],
        first_instance: u32,
        instance_count: u32,
        overlay: bool,
    ) -> Result<(), JsValue> {
        if positions.is_empty() || positions.len() % 3 != 0 {
            return Err(JsValue::from_str("Mesh positions must contain XYZ vertices"));
        }
        if normals.len() != positions.len() {
            return Err(JsValue::from_str("Mesh normals must match mesh positions"));
        }
        if indices.is_empty() || indices.len() % 3 != 0 {
            return Err(JsValue::from_str("Mesh indices must contain complete triangles"));
        }
        let vertex_count = positions.len() / 3;
        if indices.iter().any(|index| *index as usize >= vertex_count) {
            return Err(JsValue::from_str("Mesh index exceeds the vertex count"));
        }
        first_instance
            .checked_add(instance_count)
            .ok_or_else(|| JsValue::from_str("Mesh instance range overflow"))?;
        let mut vertices = Vec::with_capacity(vertex_count * 6);
        for vertex in 0..vertex_count {
            let offset = vertex * 3;
            vertices.extend_from_slice(&positions[offset..offset + 3]);
            vertices.extend_from_slice(&normals[offset..offset + 3]);
        }
        let vertex_buffer = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Sim Studio scene vertices"),
            contents: bytemuck::cast_slice(&vertices),
            usage: wgpu::BufferUsages::VERTEX,
        });
        let index_buffer = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Sim Studio scene indices"),
            contents: bytemuck::cast_slice(indices),
            usage: wgpu::BufferUsages::INDEX,
        });
        self.mesh_batches.push(MeshBatch {
            vertex_buffer,
            index_buffer,
            index_count: indices.len() as u32,
            first_instance,
            instance_count,
            overlay,
        });
        Ok(())
    }

    #[wasm_bindgen(js_name = addLines)]
    pub fn add_lines(
        &mut self,
        positions: &[f32],
        first_instance: u32,
        instance_count: u32,
        overlay: bool,
    ) -> Result<(), JsValue> {
        if positions.is_empty() || positions.len() % 6 != 0 {
            return Err(JsValue::from_str("Line positions must contain complete XYZ pairs"));
        }
        first_instance
            .checked_add(instance_count)
            .ok_or_else(|| JsValue::from_str("Line instance range overflow"))?;
        let vertex_buffer = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Sim Studio scene lines"),
            contents: bytemuck::cast_slice(positions),
            usage: wgpu::BufferUsages::VERTEX,
        });
        self.line_batches.push(LineBatch {
            vertex_buffer,
            vertex_count: (positions.len() / 3) as u32,
            first_instance,
            instance_count,
            overlay,
        });
        Ok(())
    }

    /// Uploads mat4 + RGBA/flags (20 floats per instance) in one boundary call.
    #[wasm_bindgen(js_name = uploadInstances)]
    pub fn upload_instances(&mut self, values: &[f32]) -> Result<(), JsValue> {
        if values.len() % INSTANCE_FLOATS != 0 {
            return Err(JsValue::from_str("Expected 20 floats per instance"));
        }
        let count = values.len() / INSTANCE_FLOATS;
        if count > self.instance_capacity {
            self.instance_capacity = count.next_power_of_two().max(1);
            self.instance_buffer = Self::create_instance_buffer(&self.device, self.instance_capacity);
            self.compute_bind_group = Self::create_instance_bind_group(
                &self.device,
                &self.compute_bind_group_layout,
                &self.instance_buffer,
                "Sim Studio writable instance bind group",
            );
            self.render_bind_group = Self::create_instance_bind_group(
                &self.device,
                &self.render_bind_group_layout,
                &self.instance_buffer,
                "Sim Studio read-only instance bind group",
            );
        }
        if !values.is_empty() {
            self.queue.write_buffer(&self.instance_buffer, 0, bytemuck::cast_slice(values));
        }
        self.instance_count = count as u32;
        Ok(())
    }

    #[wasm_bindgen(js_name = uploadCamera)]
    pub fn upload_camera(&self, matrix: &[f32]) -> Result<(), JsValue> {
        if matrix.len() != 16 && matrix.len() != 24 {
            return Err(JsValue::from_str(
                "Camera data must contain a 16-float matrix or the complete 24-float scene uniform",
            ));
        }
        let mut uniform = [0.0_f32; 24];
        uniform[..matrix.len()].copy_from_slice(matrix);
        if matrix.len() == 16 {
            uniform[19] = 1.0;
            uniform[23] = 0.0;
        }
        self.queue.write_buffer(&self.camera_buffer, 0, bytemuck::cast_slice(&uniform));
        Ok(())
    }

    #[wasm_bindgen]
    pub fn resize(&mut self, width: u32, height: u32) {
        let width = width.max(1);
        let height = height.max(1);
        if self.surface_config.width == width && self.surface_config.height == height { return; }
        self.surface_config.width = width;
        self.surface_config.height = height;
        self.surface.configure(&self.device, &self.surface_config);
        self.depth_texture = Self::create_depth_texture(
            &self.device,
            width,
            height,
            self.msaa_samples,
        );
        self.msaa_texture = Self::create_msaa_texture(
            &self.device,
            width,
            height,
            self.surface_config.format,
        );
    }

    #[wasm_bindgen(js_name = setMsaaSamples)]
    pub fn set_msaa_samples(&mut self, samples: u32) {
        let samples = if samples >= MSAA_SAMPLE_COUNT {
            MSAA_SAMPLE_COUNT
        } else {
            1
        };
        if self.msaa_samples == samples {
            return;
        }
        self.msaa_samples = samples;
        self.depth_texture = Self::create_depth_texture(
            &self.device,
            self.surface_config.width,
            self.surface_config.height,
            samples,
        );
    }

    #[wasm_bindgen(js_name = prepareFrame)]
    pub fn prepare_frame(&self) {
        if self.instance_count == 0 { return; }
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("Sim Studio prepare frame encoder"),
        });
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("Sim Studio prepare instances"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &self.compute_bind_group, &[]);
            pass.dispatch_workgroups(self.instance_count.div_ceil(64), 1, 1);
        }
        self.queue.submit([encoder.finish()]);
    }

    #[wasm_bindgen]
    pub fn render(&self) -> Result<bool, JsValue> {
        let frame = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(frame)
            | wgpu::CurrentSurfaceTexture::Suboptimal(frame) => frame,
            wgpu::CurrentSurfaceTexture::Timeout | wgpu::CurrentSurfaceTexture::Occluded => {
                return Ok(false);
            }
            wgpu::CurrentSurfaceTexture::Outdated => {
                self.surface.configure(&self.device, &self.surface_config);
                return Ok(false);
            }
            wgpu::CurrentSurfaceTexture::Lost | wgpu::CurrentSurfaceTexture::Validation => {
                return Err(JsValue::from_str("WebGPU canvas surface was lost"));
            }
        };
        let color_view = frame.texture.create_view(&Default::default());
        let msaa_view = self.msaa_texture.create_view(&Default::default());
        let depth_view = self.depth_texture.create_view(&Default::default());
        let (render_view, resolve_target, color_store) = if self.msaa_samples > 1 {
            (&msaa_view, Some(&color_view), wgpu::StoreOp::Discard)
        } else {
            (&color_view, None, wgpu::StoreOp::Store)
        };
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("Sim Studio visible frame encoder"),
        });
        {
            let color_attachments = [Some(wgpu::RenderPassColorAttachment {
                view: render_view,
                resolve_target,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(self.clear_color),
                    store: color_store,
                },
                depth_slice: None,
            })];
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Sim Studio visible render pass"),
                color_attachments: &color_attachments,
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &depth_view,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(1.0),
                        store: wgpu::StoreOp::Store,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_bind_group(0, &self.render_bind_group, &[]);
            pass.set_bind_group(1, &self.camera_bind_group, &[]);
            if self.mesh_batches.is_empty() && self.line_batches.is_empty() {
                pass.set_pipeline(if self.msaa_samples > 1 {
                    &self.render_pipeline
                } else {
                    &self.render_pipeline_single_sample
                });
                pass.draw(0..36, 0..self.instance_count);
            } else {
                for overlay in [false, true] {
                    pass.set_pipeline(match (overlay, self.msaa_samples > 1) {
                        (false, true) => &self.mesh_pipeline,
                        (false, false) => &self.mesh_pipeline_single_sample,
                        (true, true) => &self.mesh_pipeline_overlay,
                        (true, false) => &self.mesh_pipeline_overlay_single_sample,
                    });
                    for batch in self.mesh_batches.iter().filter(|batch| batch.overlay == overlay) {
                        pass.set_vertex_buffer(0, batch.vertex_buffer.slice(..));
                        pass.set_index_buffer(batch.index_buffer.slice(..), wgpu::IndexFormat::Uint32);
                        pass.draw_indexed(
                            0..batch.index_count,
                            0,
                            batch.first_instance..batch.first_instance + batch.instance_count,
                        );
                    }
                    pass.set_pipeline(match (overlay, self.msaa_samples > 1) {
                        (false, true) => &self.line_pipeline,
                        (false, false) => &self.line_pipeline_single_sample,
                        (true, true) => &self.line_pipeline_overlay,
                        (true, false) => &self.line_pipeline_overlay_single_sample,
                    });
                    for batch in self.line_batches.iter().filter(|batch| batch.overlay == overlay) {
                        pass.set_vertex_buffer(0, batch.vertex_buffer.slice(..));
                        pass.draw(
                            0..batch.vertex_count,
                            batch.first_instance..batch.first_instance + batch.instance_count,
                        );
                    }
                }
            }
        }
        self.queue.submit([encoder.finish()]);
        frame.present();
        Ok(true)
    }

    fn create_instance_buffer(device: &wgpu::Device, capacity: usize) -> wgpu::Buffer {
        device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Sim Studio GPU instance buffer"),
            size: (capacity.max(1) * INSTANCE_FLOATS * core::mem::size_of::<f32>()) as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        })
    }

    fn create_instance_bind_group(
        device: &wgpu::Device,
        layout: &wgpu::BindGroupLayout,
        buffer: &wgpu::Buffer,
        label: &str,
    ) -> wgpu::BindGroup {
        device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some(label),
            layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: buffer.as_entire_binding(),
            }],
        })
    }

    fn create_depth_texture(
        device: &wgpu::Device,
        width: u32,
        height: u32,
        sample_count: u32,
    ) -> wgpu::Texture {
        device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Sim Studio depth texture"),
            size: wgpu::Extent3d {
                width: width.max(1),
                height: height.max(1),
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Depth24Plus,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        })
    }

    fn create_msaa_texture(
        device: &wgpu::Device,
        width: u32,
        height: u32,
        format: wgpu::TextureFormat,
    ) -> wgpu::Texture {
        device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Sim Studio multisampled color texture"),
            size: wgpu::Extent3d {
                width: width.max(1),
                height: height.max(1),
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: MSAA_SAMPLE_COUNT,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        })
    }
}
