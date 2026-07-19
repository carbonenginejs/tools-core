function deepFreeze(value)
{
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    for (const item of Object.values(value)) deepFreeze(item);
    return Object.freeze(value);
}

// Source-backed decisions for fields that cannot be projected safely from the
// current Carbon scan alone. Keys may be a globally unique Carbon class name or
// a family-qualified "family/ClassName". Each field key is its public Blue name.
//
// These decisions are applied before candidate scoring. They deliberately keep
// the native cppType intact while selecting the correct declaration and/or
// supplying the public runtime type.
export const DEFAULT_FIELD_RESOLUTIONS = deepFreeze({
    EveChildQuad: {
        brightness: {
            member: "m_brightness",
            select: { cppType: "float" },
            type: "float32",
            reason: "The scanner flattens a private Float_16 GPU member over the exposed float member.",
            source: "trinity/trinity/Eve/SpaceObject/Children/EveChildQuad.h"
        },
        color: {
            member: "m_color",
            select: { cppType: "Color" },
            type: "color",
            reason: "The scanner flattens a private Float_16 GPU member over the exposed Color member.",
            source: "trinity/trinity/Eve/SpaceObject/Children/EveChildQuad.h"
        }
    },
    EveSmartLightQuad: {
        brightness: {
            member: "m_brightness",
            select: { cppType: "float" },
            type: "float32",
            reason: "The scanner flattens a private Float_16 GPU member over the exposed float member.",
            source: "trinity/trinity/Eve/SpaceObject/Children/SmartLightSets/EveSmartLightQuad.h"
        }
    },
    Tr2GpuBuffer: {
        creationFlags: {
            member: "m_creationFlags",
            expects: { cppType: "CreationFlags" },
            type: "uint32",
            reason: "CreationFlags is a class-scoped uint32_t bitmask typedef, not an inline object.",
            source: "trinity/trinity/Tr2GpuBuffer.h"
        }
    },
    Tr2GpuStructuredBuffer: {
        creationFlags: {
            member: "m_creationFlags",
            expects: { cppType: "CreationFlags" },
            type: "uint32",
            reason: "CreationFlags is a class-scoped uint32_t bitmask typedef, not an inline object.",
            source: "trinity/trinity/Tr2GpuStructuredBuffer.h"
        }
    },
    EveSOFDataGeneric: {
        bannerShader: {
            member: "m_bannerShader",
            wire: { beType: "IROOT", wireType: "inlineObject" },
            reason: "Carbon exposes the embedded banner shader through an explicit Blue inline-object definition."
        }
    },
    TriVector: {
        x: inheritedFloat("x", "TriVector inherits its persisted components from the native Vector3 base.", "trinity/trinity/Include/TriVector.h"),
        y: inheritedFloat("y", "TriVector inherits its persisted components from the native Vector3 base.", "trinity/trinity/Include/TriVector.h"),
        z: inheritedFloat("z", "TriVector inherits its persisted components from the native Vector3 base.", "trinity/trinity/Include/TriVector.h")
    },
    TriColor: {
        r: inheritedFloat("r", "TriColor inherits this persisted component from the native Color base.", "trinity/trinity/Include/TriColor.h"),
        g: inheritedFloat("g", "TriColor inherits this persisted component from the native Color base.", "trinity/trinity/Include/TriColor.h"),
        b: inheritedFloat("b", "TriColor inherits this persisted component from the native Color base.", "trinity/trinity/Include/TriColor.h")
    },
    TriQuaternion: {
        x: inheritedFloat("x", "TriQuaternion inherits its persisted components from the native Quaternion base.", "trinity/trinity/Include/TriQuaternion.h"),
        y: inheritedFloat("y", "TriQuaternion inherits its persisted components from the native Quaternion base.", "trinity/trinity/Include/TriQuaternion.h"),
        z: inheritedFloat("z", "TriQuaternion inherits its persisted components from the native Quaternion base.", "trinity/trinity/Include/TriQuaternion.h"),
        w: inheritedFloat("w", "TriQuaternion inherits its persisted components from the native Quaternion base.", "trinity/trinity/Include/TriQuaternion.h")
    },
    TriMatrix: {
        ...inheritedFloatFields([
            "_12", "_13", "_14",
            "_21", "_22", "_23", "_24",
            "_31", "_32", "_33", "_34",
            "_41", "_42", "_43", "_44"
        ], "TriMatrix inherits this persisted component from the native Matrix base.", "trinity/trinity/Include/TriMatrix.h")
    },
    Tr2PPBloomEffect: {
        ...indexedDefinedFields("step", "Size", "m_stepSizes", 6, "float", "float32",
            "The exposed indexed member is an element of the native std::array<float, ...>.",
            "trinity/trinity/PostProcess/Effects/Tr2PPBloomEffect.h"),
        ...indexedDefinedFields("step", "Tint", "m_stepTints", 6, "Color", "color",
            "The exposed indexed member is an element of the native std::array<Color, ...>.",
            "trinity/trinity/PostProcess/Effects/Tr2PPBloomEffect.h")
    },
    Tr2PPTonemappingEffect: {
        ...definedFields({
            toe: "m_aces.m_toe",
            shoulder: "m_aces.m_shoulder",
            blackClip: "m_aces.m_blackClip",
            whiteClip: "m_aces.m_whiteClip",
            blueCorrection: "m_aces.m_blueCorrection",
            slope: "m_aces.m_slope",
            scale: "m_aces.m_scale"
        }, "float", "float32", "The exposed member is declared inside the native Aces parameter structure.",
        "trinity/trinity/PostProcess/Effects/Tr2PPTonemappingEffect.h"),
        useSweeteners: definedField("m_aces.m_useSweeteners", "bool", "boolean",
            "The exposed member is declared inside the native Aces parameter structure.",
            "trinity/trinity/PostProcess/Effects/Tr2PPTonemappingEffect.h"),
        ...definedFields({
            shoulderStrength: "m_uncharted2.m_shoulderStrength",
            linearStrength: "m_uncharted2.m_linearStrength",
            linearAngle: "m_uncharted2.m_linearAngle",
            toeStrength: "m_uncharted2.m_toeStrength",
            toeNumerator: "m_uncharted2.m_toeNumerator",
            toeDenominator: "m_uncharted2.m_toeDenominator",
            whiteScale: "m_uncharted2.m_whiteScale"
        }, "float", "float32", "The exposed member is declared inside the native Uncharted2 parameter structure.",
        "trinity/trinity/PostProcess/Effects/Tr2PPTonemappingEffect.h"),
        method: definedField("m_method", "int32_t", "int32",
            "The exposed member is an anonymous native enum with Uncharted2, Aces, and AgX ordinals; its Blue chooser supplies the public enum semantics.",
            "trinity/trinity/PostProcess/Effects/Tr2PPTonemappingEffect.h")
    },
    Tr2BoneMatrixCurve: {
        currentValue: definedField("m_currentValue", "Matrix", "mat4", "The member is inherited from Tr2CurveBase instantiated with Matrix values.", "trinity/trinity/include/Tr2Curve.h"),
        cycle: definedField("m_cycle", "bool", "boolean", "The member is inherited from the native Tr2CurveBase template.", "trinity/trinity/include/Tr2Curve.h"),
        endValue: definedField("m_endValue", "Matrix", "mat4", "The member is inherited from Tr2CurveBase instantiated with Matrix values.", "trinity/trinity/include/Tr2Curve.h"),
        keys: definedWireField("m_keys", "PTr2MatrixKeyVector", { beType: "IROOT", wireType: "container", container: "list" }, "The member is inherited from Tr2CurveBase instantiated with the Tr2MatrixKey vector type.", "trinity/trinity/include/Tr2Curve.h"),
        length: definedField("m_length", "float", "float32", "The member is inherited from the native Tr2CurveBase template.", "trinity/trinity/include/Tr2Curve.h"),
        name: definedField("m_name", "std::string", "string", "The member is inherited from the native Tr2CurveBase template.", "trinity/trinity/include/Tr2Curve.h"),
        reversed: definedField("m_reversed", "bool", "boolean", "The member is inherited from the native Tr2CurveBase template.", "trinity/trinity/include/Tr2Curve.h"),
        startValue: definedField("m_startValue", "Matrix", "mat4", "The member is inherited from Tr2CurveBase instantiated with Matrix values.", "trinity/trinity/include/Tr2Curve.h")
    },
    Tr2MatrixKey: {
        time: definedField("m_time", "float", "float32", "The member is inherited from Tr2Key<Matrix>.", "trinity/trinity/include/Tr2Curve.h"),
        value: definedField("m_value", "Matrix", "mat4", "The member is inherited from Tr2Key<Matrix>.", "trinity/trinity/include/Tr2Curve.h")
    },
    Tr2ScalarExprKey: {
        interpolation: {
            member: "m_interpolation",
            define: { cppType: "Interpolation" },
            reason: "The member is inherited from Tr2Key<float>, and Interpolation is the native curve interpolation enum.",
            source: "trinity/trinity/include/Tr2Curve.h"
        },
        time: definedField("m_time", "float", "float32", "The member is inherited from Tr2Key<float>.", "trinity/trinity/include/Tr2Curve.h"),
        value: definedField("m_value", "float", "float32", "The member is inherited from Tr2Key<float>.", "trinity/trinity/include/Tr2Curve.h")
    },
    Tr2PresentParameters: {
        software: definedField("software", "bool", "boolean", "The member is inherited from the native Tr2PresentParametersAL structure.", "trinity/trinityal/Tr2AdapterStructures.h"),
        backBufferWidth: definedField("mode.width", "uint32_t", "uint32", "The exposed member is the width component of the inherited native display mode.", "trinity/trinityal/Tr2AdapterStructures.h"),
        backBufferHeight: definedField("mode.height", "uint32_t", "uint32", "The exposed member is the height component of the inherited native display mode.", "trinity/trinityal/Tr2AdapterStructures.h"),
        windowed: definedField("windowed", "bool", "boolean", "The member is inherited from the native Tr2PresentParametersAL structure.", "trinity/trinityal/Tr2AdapterStructures.h")
    },
    TriTextureParameter: {
        ...definedFields({
            positionScale: "m_uvDensityScale[0]",
            uvDensityScale0: "m_uvDensityScale[1]",
            uvDensityScale1: "m_uvDensityScale[2]",
            uvDensityScale2: "m_uvDensityScale[3]",
            uvDensityScale3: "m_uvDensityScale[4]"
        }, "float", "float32", "The exposed indexed member is an element of the native m_uvDensityScale float array.",
        "trinity/trinity/Shader/Parameter/TriTextureParameter.h")
    },
    EveEllipseDefinition: {
        center: definedField("m_center", "Vector3", "vec3", "The header declares the persisted ellipse center as a native Vector3.", "trinity/trinity/Eve/UI/EveEllipseDefinition.h"),
        planeNormal: definedField("m_planeNormal", "Vector3", "vec3", "The header declares the persisted ellipse plane normal as a native Vector3.", "trinity/trinity/Eve/UI/EveEllipseDefinition.h")
    },
    EveSpaceSceneRenderDriver: {
        depthPassTechnique: definedField("m_depthPassTechnique", "BlueSharedString", "string", "The header declares the depth-pass technique name as a BlueSharedString.", "trinity/trinity/Eve/EveSpaceSceneRenderDriver.h")
    },
    Tr2HostBitmap: {
        format: definedEnumField("m_format", "ImageIO::PixelFormat", "The member is inherited from ImageIO::BitmapDimensions.", "imageio/include/BitmapDimensions.h"),
        width: definedField("m_width", "uint32_t", "uint32", "The member is inherited from ImageIO::BitmapDimensions.", "imageio/include/BitmapDimensions.h"),
        height: definedField("m_height", "uint32_t", "uint32", "The member is inherited from ImageIO::BitmapDimensions.", "imageio/include/BitmapDimensions.h"),
        mipCount: definedField("m_mipCount", "uint32_t", "uint32", "The member is inherited from ImageIO::BitmapDimensions.", "imageio/include/BitmapDimensions.h"),
        imageType: definedEnumField("m_type", "ImageIO::TextureType", "The member is inherited from ImageIO::BitmapDimensions.", "imageio/include/BitmapDimensions.h"),
        name: definedField("m_name", "std::string", "string", "The persisted bitmap name is declared by the native HostBitmap base.", "imageio/include/HostBitmap.h")
    },
    TriTextureRes: {
        format: definedEnumField("m_format", "ImageIO::PixelFormat", "The member is inherited from the native bitmap-dimensions base.", "imageio/include/BitmapDimensions.h"),
        type: definedEnumField("m_type", "ImageIO::TextureType", "The member is inherited from the native bitmap-dimensions base.", "imageio/include/BitmapDimensions.h"),
        depth: definedField("m_volumeDepth", "uint32_t", "uint32", "The member is inherited from the native bitmap-dimensions base.", "imageio/include/BitmapDimensions.h"),
        height: definedField("m_height", "uint32_t", "uint32", "The member is inherited from the native bitmap-dimensions base.", "imageio/include/BitmapDimensions.h"),
        arraySize: definedField("m_arraySize", "uint32_t", "uint32", "The member is inherited from the native bitmap-dimensions base.", "imageio/include/BitmapDimensions.h"),
        width: definedField("m_width", "uint32_t", "uint32", "The member is inherited from the native bitmap-dimensions base.", "imageio/include/BitmapDimensions.h")
    },
    EveChildLightingOverride: {
        priority: definedEnumField("m_overrides.priority", "PostProcessEnums::Priority", "The nested OverrideInfo priority member uses the native post-process priority enum.", "trinity/trinity/Eve/SpaceObject/Children/EveChildLightingOverride.h"),
        backgroundIntensity: definedField("m_overrides.value.backgroundIntensity", "float", "float32", "The nested Overrides structure declares background intensity as float.", "trinity/trinity/Eve/SpaceObject/Children/EveChildLightingOverride.h"),
        reflectionIntensity: definedField("m_overrides.value.reflectionIntensity", "float", "float32", "The nested Overrides structure declares reflection intensity as float.", "trinity/trinity/Eve/SpaceObject/Children/EveChildLightingOverride.h"),
        sunIntensity: definedField("m_overrides.value.sunIntensity", "float", "float32", "The nested Overrides structure declares sun intensity as float.", "trinity/trinity/Eve/SpaceObject/Children/EveChildLightingOverride.h"),
        sunColor: definedField("m_overrides.value.sunColor", "Color", "color", "The nested Overrides structure declares sun color as Color.", "trinity/trinity/Eve/SpaceObject/Children/EveChildLightingOverride.h")
    },
    TriDevice: {
        multiSampleType: definedField("mPresentParam.msaaType", "uint32_t", "uint32", "The persisted nested member is the uint32_t msaaType field of Tr2PresentParametersAL; the scan retains only the mPresentParam root declaration.", "trinity/trinityal/Tr2AdapterStructures.h"),
        multiSampleQuality: definedField("mPresentParam.msaaQuality", "uint32_t", "uint32", "The persisted nested member is the uint32_t msaaQuality field of Tr2PresentParametersAL; the scan retains only the mPresentParam root declaration.", "trinity/trinityal/Tr2AdapterStructures.h")
    },
    Tr2SSAO: {
        ...definedFields({
            shadowClamp: "m_detail.settings.shadowClamp",
            shadowMultiplier: "m_detail.settings.shadowMultiplier",
            shadowPower: "m_detail.settings.shadowPower",
            sharpness: "m_detail.settings.sharpness"
        }, "float", "float32", "AMD FidelityFX CACAO declares this member of FFX_CACAO_Settings as float.",
        "https://gpuopen.com/manuals/fidelityfx_sdk/reference_documentation/structs/ffx_cacao_settings/")
    }
});

function inheritedFloat(member, reason, source)
{
    return definedField(member, "float", "float32", reason, source);
}

function definedField(member, cppType, type, reason, source)
{
    return {
        member,
        define: { cppType },
        type,
        reason,
        source
    };
}

function definedFields(members, cppType, type, reason, source)
{
    return Object.fromEntries(Object.entries(members).map(([ name, member ]) => [
        name,
        definedField(member, cppType, type, reason, source)
    ]));
}

function definedWireField(member, cppType, wire, reason, source)
{
    return {
        member,
        define: { cppType },
        wire,
        reason,
        source
    };
}

function definedEnumField(member, cppType, reason, source)
{
    return {
        member,
        define: { cppType },
        reason,
        source
    };
}

function indexedDefinedFields(prefix, suffix, member, count, cppType, type, reason, source)
{
    return Object.fromEntries(Array.from({ length: count }, (_, index) => [
        `${prefix}${index + 1}${suffix}`,
        definedField(`${member}[${index}]`, cppType, type, reason, source)
    ]));
}

function inheritedFloatFields(members, reason, source)
{
    return Object.fromEntries(members.map(member => [
        member,
        inheritedFloat(member, reason, source)
    ]));
}
