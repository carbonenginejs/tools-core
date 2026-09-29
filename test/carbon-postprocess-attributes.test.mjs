import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { CjsFormatCarbon } from "../src/schema/index.js";
const require = createRequire(import.meta.url);
const { __test: scanner } = require("../scripts/carbon-blue/convert.cjs");

// Tr2PostProcessAttributes_Blue.cpp:41-47 stringifies the public name and
// exposes two members of PriorityBlend::Attribute<T> (PriorityBlend.h:11-27).
const BLUE = [
  'BLUE_DEFINE( Tr2PostProcessAttributes );',
  'EXPOSURE_BEGIN( Tr2PostProcessAttributes, "" )',
  '#define POSTPROCESSATTRIBUTE_DEFINE( NAME, GROUP, DESC ) \\',
  ' MAP_ATTRIBUTE( #NAME "Enabled", NAME.enabled, "Enables " #NAME, Be::READWRITE | Be::PERSIST ) \\',
  ' MAP_ATTRIBUTE( #NAME, NAME.value, DESC, Be::READWRITE | Be::PERSIST )',
  '#define POSTPROCESSATTRIBUTE_DEFINE_ENUM( NAME, GROUP, DESC, CHOOSER ) \\',
  ' MAP_ATTRIBUTE( #NAME "Enabled", NAME.enabled, "", Be::READWRITE | Be::PERSIST ) \\',
  ' MAP_ATTRIBUTE_WITH_CHOOSER( #NAME, NAME.value, DESC, Be::READWRITE | Be::PERSIST | Be::ENUM, CHOOSER )',
  'POSTPROCESSATTRIBUTE_DEFINE( whiteTemperature, Color Correction, "temperature" )',
  'POSTPROCESSATTRIBUTE_DEFINE( filmGrainColored, Film Grain, "colored" )',
  'POSTPROCESSATTRIBUTE_DEFINE( fadeColor, Fade, "color" )',
  'POSTPROCESSATTRIBUTE_DEFINE( vignetteDetail1Size, Vignette, "size" )',
  'POSTPROCESSATTRIBUTE_DEFINE( colorGain, Color Correction, "gain" )',
  'POSTPROCESSATTRIBUTE_DEFINE( grimePath, Grime, "path" )',
  'POSTPROCESSATTRIBUTE_DEFINE_ENUM( depthOfFieldShape, Depth Of Field, "shape", Tr2Bokeh::BokehShapeChooser )',
  'MAP_ATTRIBUTE( "intensity", intensity, "", Be::READ )',
  'EXPOSURE_END()'
].join('\n');
const TYPES = [
  ['whiteTemperature','float','float'],
  ['filmGrainColored','bool','boolean'],
  ['fadeColor','Color','color'],
  ['vignetteDetail1Size','Vector2','vector2'],
  ['colorGain','Vector3','vector3'],
  ['grimePath','BlueSharedString','string'],
  ['depthOfFieldShape','Tr2Bokeh::Shape',{type:'enum',enum:'Shape'}]
];
function report()
{
  const blue = scanner.parseBlueFile(scanner.expandLocalClassMacros(BLUE), 'trinity/Tr2PostProcessAttributes_Blue.cpp').classes[0];
  return {
    generatedAt:'2026-09-29T00:00:00.000Z',
    enums:[{name:'Shape',qualifiedName:'Tr2Bokeh::Shape',family:'trinityCore',values:[{name:'Disk',value:0},{name:'Heart',value:5}]}],
    families:[{name:'trinityCore',root:'trinity',classes:[{
      name:'Tr2PostProcessAttributes',family:'trinityCore',declarationKind:'class',
      headerFiles:['trinity/Tr2PostProcessAttributes.h'],cppFiles:[],bases:[],methods:[],
      fields:TYPES.map(([name,type])=>({name,type:`PriorityBlend::Attribute<${type}>`})),
      defaults:{whiteTemperature:{value:'6500.f'},filmGrainColored:{value:'Attribute( false, true )'}},
      blue:{...blue,isExposed:true,files:['trinity/Tr2PostProcessAttributes_Blue.cpp']}
    }]}]
  };
}

test('postprocess macros expand every paired name and preserve source lines and enum chooser', () =>
{
  const {attributes}=report().families[0].classes[0].blue;
  assert.equal(attributes.length,15);
  for(let index=0;index<TYPES.length;index++)
  {
    const [name]=TYPES[index];
    assert.deepEqual(attributes.slice(index*2,index*2+2).map(value=>[value.name,value.member,value.line]),
      [[name+'Enabled',name+'.enabled',9+index],[name,name+'.value',9+index]]);
  }
  assert.equal(attributes.find(value=>value.name==='depthOfFieldShape').chooser,'Tr2Bokeh::BokehShapeChooser');
});

test('compact definitions use the actual Attribute<T> leaves for all seven persisted value types', () =>
{
  const definitions=CjsFormatCarbon.readBlackDefinitions(report()).classes.Tr2PostProcessAttributes;
  assert.equal(Object.keys(definitions).length,14,'nonpersisted intensity is not a Black field');
  for(const [name,,wire] of TYPES)
  {
    assert.deepEqual(definitions[name],wire,name);
    assert.equal(definitions[name+'Enabled'],'boolean',name+'Enabled');
  }
});

test('wrapper initialization is not misreported as an enabled or value leaf default', () =>
{
  const attributes=CjsFormatCarbon.read(report()).families[0].classes[0].attributes;
  for(const name of ['whiteTemperatureEnabled','whiteTemperature','filmGrainColoredEnabled','filmGrainColored'])
  {
    const field=attributes.find(value=>value.blueName===name);
    assert.equal(field.default,undefined,'unknown leaf defaults must not inherit the root wrapper expression: '+name);
  }
});
