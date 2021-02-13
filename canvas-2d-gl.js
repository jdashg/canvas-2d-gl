(() => {
   const GL = WebGLRenderingContext;

   window.OVERRIDE_2D = false;

   if (window._HAS_CANVAS_2D_GL) return;
   window._HAS_CANVAS_2D_GL = true;
   console.log('[canvas-2d-gl] Injected.');

   // -

   const next_id = (() => {
      let prev_id = 0;
      return () => {
         prev_id += 1;
         return prev_id;
      };
   })();

   function obj_id(x) {
      if (!x._obj_id) {
         x._obj_id = next_id();
      }
      return x._obj_id;
   }

   // -

   function array_equals(a, b) {
      if (a === b) return true;
      if (!a || !b) return false;
      if (a.length != b.length) return false;
      let ret = true;
      for (const i in a) {
         ret &= a[i] == b[i];
      }
      return ret;
   }

   // -

   function create_c2d(w, h) {
      const elem = document.createElement('canvas');
      elem.width = w;
      elem.height = h;
      return elem.getContext('2d', {webgl:false});
   }

   // -

   function is_any_inf_or_nan() {
      let any = false;
      for (const x of arguments) {
         any |= !isFinite(x) || isNaN(x);
      }
      return any;
   }

   class Path2DGL extends Path2D {
      _lines = [];
      _rects = true;
      _joins = false;
      _subpath_begin = null;
      _subpath_cur = null;

      constructor(src_path) {
         super(...arguments);
         console.error('FYI new Path2DGL');

         if (!src_path) return;
         this.addPath(src_path);
      }

      addPath(path, transform) {
         super.addPath(...arguments);

         transform = new DOMMatrix(transform);

         this._rects = path._rects;
         this._joins = path._joins;
         if (path._lines == null) {
            this._lines = null;
            return;
         }

         for (const p of path._lines) {
            this._lines.push(transform.transformPoint(p));
         }
         if (path._subpath_begin) {
            this._subpath_begin = transform.transformPoint(path._subpath_begin);
         }
         if (path._subpath_cur) {
            this._subpath_cur = transform.transformPoint(path._subpath_cur);
         }
      }

      // -

      _rect_data() {
         const lines = this._lines;
         if (lines == null) return null;
         if (!this._rects) return null;

         // TRIANGLE_STRIP order

         const ret = new Float32Array(2 * lines.length / 2);
         for (let i = 0; i < lines.length; i += 8) {
            ret[i+0] = lines[i+0].x; // (x, y)
            ret[i+1] = lines[i+0].y;

            ret[i+2] = lines[i+2].x; // (x+w, y)
            ret[i+3] = lines[i+2].y;

            ret[i+4] = lines[i+6].x; // (x, y+h)
            ret[i+5] = lines[i+6].y;

            ret[i+6] = lines[i+4].x; // (x+w, y+h)
            ret[i+7] = lines[i+4].y;
         }
         return ret;
      }

      _line_data() {
         const lines = this._lines;
         if (lines == null) return null;

         const ret = new Float32Array(2 * lines.length);
         for (let i = 0; i < lines.length; i += 1) {
            ret[2*i+0] = lines[i].x;
            ret[2*i+1] = lines[i].y;
         }
         ret._only_right_angles = this._rect;
         ret._joins = this._joins;
         return ret;
      }

      // -

      moveTo() {
         super.moveTo(...arguments);
         if (this._lines == null) return;

         this._rects = false;
         this._moveTo(...arguments);
      }

      lineTo() {
         super.lineTo(...arguments);
         if (this._lines == null) return;

         this._rects = false;
         this._lineTo(...arguments);
      }

      // -

      _moveTo(x, y, transform) {
         if (!this._lines) throw 1;

         // 1. If either of the arguments are infinite or NaN, then return.
         if (is_any_inf_or_nan(x, y)) return;

         // 2. Create a new subpath with the specified point as its first (and only) point.
         let p = new DOMPoint(x, y);
         if (transform) {
            p = transform.transformPoint(p);
         }
         this._subpath_begin = this._subpath_cur = p;
      }

      _lineTo(x, y, transform) {
         if (!this._lines) throw 1;

         // 1. If either of the arguments are infinite or NaN, then return.
         if (is_any_inf_or_nan(x, y)) return;

         // 2. If the object's path has no subpaths, then ensure there is a subpath for (x, y).
         if (!this._subpath_cur) {
            this._moveTo(x, y, transform);
            return;
         }

         // 3. Otherwise, connect the last point in the subpath to the given point (x, y) using
         //    a straight line, and then add the given point (x, y) to the subpath.
         this._joins |= (this._subpath_cur != this._subpath_begin);
         let p = new DOMPoint(x, y);
         if (transform) {
            p = transform.transformPoint(p);
         }
         const lines = this._lines;
         lines.push(this._subpath_cur);
         lines.push(p);
         this._subpath_cur = p;
      }

      // -

      rect(x, y, w, h, transform) {
         super.rect(x, y, w, h);
         if (this._lines == null) return;

         // 1. If any of the arguments are infinite or NaN, then return.
         if (is_any_inf_or_nan(x, y, w, h)) return;

         // 2. Create a new subpath containing just the four points (x, y), (x+w, y),
         //    (x+w, y+h), (x, y+h), in that order, with those four points connected by
         //    straight lines.
         this._moveTo(x, y, transform);
         this._lineTo(x+w, y, transform);
         this._lineTo(x+w, y+h, transform);
         this._lineTo(x, y+h, transform);

         // 3. Mark the subpath as closed.
         // 4. Create a new subpath with the point (x, y) as the only point in the subpath.
         this._lineTo(x, y, transform);

         this._moveTo(x, y, transform);
      }

      // -

      // The closePath() method, when invoked, must do nothing if the object's path has no
      // subpaths. Otherwise, it must mark the last subpath as closed, create a new subpath
      // whose first point is the same as the previous subpath's first point, and finally add
      // this new subpath to the path.
      closePath() {
         super.closePath(...arguments);
         if (this._lines == null) return;

         const begin = this._subpath_begin;
         if (!begin) return;

         this._line_to(begin.x, begin.y);
         this._move_to(begin.x, begin.y);
      }

      // -

      quadraticCurveTo(cpx, cpy, x, y) {
         super.quadraticCurveTo(...arguments);
         this._lines = null;
      }
      bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y) {
         super.bezierCurveTo(...arguments);
         this._lines = null;
      }
      arcTo(x1, y1, x2, y2, radius) {
         super.arcTo(...arguments);
         this._lines = null;
      }
      arc(x, y, radius, start_angle, end_angle, anticlockwise) {
         super.arc(...arguments);
         this._lines = null;
      }
      ellipse(x, y, radius_x, radius_y, rotation, start_angle, end_angle, anticlockwise) {
         super.ellipse(...arguments);
         this._lines = null;
      }
   };
   window.Path2D = Path2DGL;

   // -
   /*
   function hook_prop(obj, prop_name, override_desc) {
      const proto = Object.getPrototypeOf(obj);
      const proto_prop_desc = Object.getOwnPropertyDescriptor(proto, prop_name);
      const prop_desc = {};
      for (const k in proto_prop_desc) {
         prop_desc[k] = proto_prop_desc[k];
         if (override_desc[k]) {
            if (k == 'get' || k == 'set') {
               prop_desc[k] = function() {
                  const orig_fn = proto_prop_desc[k];
                  const new_args = [].concat([].slice.call(arguments), orig_fn);
                  console.log(new_args);
                  return override_desc[k].apply(this, new_args);
               };
            }
         }
      }
      Object.defineProperty(obj, prop_name, prop_desc);
   }
   */
   // -

   function hook_prop(obj, k, fn_observe, fn_override) {
      const desc = Object.getOwnPropertyDescriptor(obj, k);

      function hook(desc_key, k_name) {
         //console.log(`hook_prop: ${obj.constructor.name}.${k_name}`);
         const was = desc[desc_key];
         if (!was) return;
         desc[desc_key] = function() {
            if (fn_override) {
               const boxed_result = fn_override(this, k_name, was, arguments);
               if (boxed_result) return boxed_result[0];
            }

            const ret = was.apply(this, arguments);
            if (fn_observe) {
               fn_observe(this, k_name, arguments, ret);
            }
            return ret;
         };
      }

      hook('get', 'get ' + k);
      hook('set', 'set ' + k);
      if (typeof desc.value === 'function') {
         hook('value', k);
      }

      Object.defineProperty(obj, k, desc);
   }

   function on_width_height(obj, k, args, ret) {
      if (args.length != 1) return;
      const context = obj._gl2d_context;
      if (!context) return;
      if (!context._reset) return;
      context._reset();
   }
   hook_prop(HTMLCanvasElement.prototype, 'width', on_width_height);
   hook_prop(HTMLCanvasElement.prototype, 'height', on_width_height);

   // -

   function make_rect(x_or_arr, y, w, h) {
      let x = x_or_arr;
      if (y === undefined) {
         const arr = x_or_arr;
         x = arr[0];
         y = arr[1];
         w = arr[2];
         h = arr[3];
      }
      return {x:x, y:y, w:w, h:h};
   }

   function abs_rect(rect) {
      if (rect.w < 0) {
         rect.x += rect.w;
         rect.w *= -1;
      }
      if (rect.h < 0) {
         rect.y += rect.h;
         rect.h *= -1;
      }
   }

   function scale_rect(rect, scaleX, scaleY) {
      rect.x *= scaleX;
      rect.y *= scaleY;
      rect.w *= scaleX;
      rect.h *= scaleY;
   }

   function flip_y(rect, height) {
      rect.y = height - (rect.y + rect.h);
   }

   function normalize_canvas_rect(rect, gl) {
      scale_rect(rect, 1.0 / gl.canvas.width, 1.0 / gl.canvas.height);
      flip_y(rect, 1.0);
   }

   // -

   function create_nomip_texture(gl) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      return tex;
   }

   // -

   function linkProgramSources(gl, vertSource, fragSource, bind_attribs) {
      bind_attribs = bind_attribs || [];

      const prog = gl.createProgram();

      function attachShaderSource(type, glsl) {
         glsl = glsl.trim() + '\n';

         const shader = gl.createShader(type);
         gl.shaderSource(shader, glsl);
         gl.compileShader(shader);
         gl.attachShader(prog, shader);
         return shader;
      }
      const vs = attachShaderSource(gl.VERTEX_SHADER, vertSource);
      const fs = attachShaderSource(gl.FRAGMENT_SHADER, fragSource);

      for (const i in bind_attribs) {
         const name = bind_attribs[i];
         gl.bindAttribLocation(prog, i, name);
      }

      gl.linkProgram(prog);

      const success = gl.getProgramParameter(prog, gl.LINK_STATUS);
      if (!success) {
         console.log('Error linking program: ' + gl.getProgramInfoLog(prog));
         console.log('\nVert shader log: ' + gl.getShaderInfoLog(vs));
         console.log('\nFrag shader log: ' + gl.getShaderInfoLog(fs));
         return null;
      }
      gl.deleteShader(vs);
      gl.deleteShader(fs);

      let count = gl.getProgramParameter(prog, gl.ACTIVE_ATTRIBUTES);
      for (let i = 0; i < count; i++) {
         const info = gl.getActiveAttrib(prog, i);
         prog[info.name] = gl.getAttribLocation(prog, info.name);
      }
      count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < count; i++) {
         const info = gl.getActiveUniform(prog, i);
         prog[info.name] = gl.getUniformLocation(prog, info.name);
      }
      return prog;
   }

   function parse_color(style_str) {
      const arr = (function() {
         if (style_str[0] == '#') {
            const str = style_str.substring(1);
            const per_channel = (str.length <= 4) ? 1 : 2;
            const color = [0,0,0,0].map((x, i) => {
               let part = str.substring(per_channel*i, per_channel*(i+1));
               if (!part.length) {
                  part = 'f';
               }
               if (part.length == 1) {
                  part = part + part;
               }
               const ret = parseInt(part, 16);
               return ret / 255.0;
            });
            return color;
         }

         const re_rgba = /rgba?[(](.+)[)]/;
         const re_sep = / *[, \/] */g;
         const m = style_str.match(re_rgba);
         if (m) {
            const rgba_str = m[1];
            let arr = rgba_str.trim().split(re_sep);
            arr[3] = arr[3] || 1;
            arr = arr.map((x, i) => {
               if (x.endsWith('%')) {
                  x = x.substring(0, x.length-1);
                  return x / 100.0;
               }
               const scale = (i == 3 ? 1 : 255);
               return x / scale;
            });
            return arr;
         }

         throw new Error('Bad style_str: ' + style_str);
      })();
      arr[0] *= arr[3];
      arr[1] *= arr[3];
      arr[2] *= arr[3];
      return arr;
   }

   const INITIAL_DRAW_STATE = {
      fillStyle               : '#000',
      font                    : '10px sans-serif',
      globalAlpha             : 1.0,
      globalCompositeOperation: 'source-over',
      imageSmoothingEnabled   : true,
      lineCap                 : 'butt',
      lineDashOffset          : 0.0,
      lineJoin                : 'miter',
      lineWidth               : 1.0,
      miterLimit              : 10.0,
      shadowBlur              : 0,
      shadowColor             : '#0000',
      shadowOffsetX           : 0,
      shadowOffsetY           : 0,
      strokeStyle             : '#000',
      textAlign               : 'start',
      textBaseline            : 'alphabetic',
      _transform              : null,
      _line_dash              : [],
   };

   class CanvasRenderingContextGL2D {
      constructor(gl) {
         const c2d_canvas = document.createElement('canvas');
         c2d_canvas.width = gl.canvas.width;
         c2d_canvas.height = gl.canvas.height;
         const c2d = c2d_canvas.getContext('2d', {webgl: false});
         //document.body.appendChild(c2d_canvas);

         this.gl = gl;
         this.c2d = c2d;

         const gl2d = this;

         for (const k in INITIAL_DRAW_STATE) {
            if (k[0] == '_')
               continue;
            Object.defineProperty(this, k, {
               enumerable: true,
               get: function() { return gl2d._state[k]; },
               set: function(val) {
                  //c2d[k] = val;
                  //console.log(`${k}: ${val} => ${c2d[k]}`);
                  gl2d._state[k] = val;
               },
            });
         }

         this._reset();

         // -

         const BLIT_VS = `
attribute vec2 a_box01;
uniform vec4 u_dest_rect;
uniform vec4 u_tex_rect;
varying vec2 v_tex_coord;

void main() {
   vec2 dest_pos = u_dest_rect.xy + a_box01 * u_dest_rect.zw;
   gl_Position = vec4(dest_pos * 2.0 - 1.0, 0.0, 1.0);
   v_tex_coord = u_tex_rect.xy + a_box01 * u_tex_rect.zw;
}`.trim();
         const BLIT_FS = `
precision mediump float;

uniform sampler2D u_tex;
varying vec2 v_tex_coord;

void main() {
    gl_FragColor = texture2D(u_tex, v_tex_coord);
}`.trim();
         this.blit_prog = linkProgramSources(gl, BLIT_VS, BLIT_FS, ['a_box01']);

         // -

         const RECT_VS = `
attribute float a_vertex_id;
attribute vec2 a_dest;
uniform vec4 u_src_rect;
uniform vec2 u_canvas_size;
varying vec2 v_tex_coord;

vec2 corner01_by_id(float vertex_id) {
   float corner01x = mod(vertex_id, 2.0);
   vec2 corner01 = vec2(corner01x, mod((vertex_id - corner01x) / 2.0, 2.0));
   return corner01;
}

void main() {
   vec2 corner01 = corner01_by_id(a_vertex_id);

   gl_Position = vec4(a_dest / u_canvas_size * 2.0 - 1.0, 0.0, 1.0);

   gl_Position.y *= -1.0;

   v_tex_coord = u_src_rect.xy + corner01 * u_src_rect.zw;
}`.trim();
         const TEX_FS = `
precision mediump float;

uniform sampler2D u_sampler;
uniform vec4 u_color;
varying vec2 v_tex_coord;

void main() {
    gl_FragColor = texture2D(u_sampler, v_tex_coord);
    gl_FragColor *= u_color;
    //gl_FragColor.rg = (gl_FragColor.rg + v_tex_coord) / 2.0;
    //gl_FragColor.a = 1.0;
}`.trim();
         const LINE_VS = `
attribute float a_vertex_id;
attribute vec4 a_xy0xy1;
uniform mediump vec4 u_line_info;
uniform vec2 u_canvas_size;
uniform mat3 u_transform;
varying vec2 v_line_coord;
varying float v_line_height;

vec2 corner01_by_id(float vertex_id) {
   float corner01x = mod(vertex_id, 2.0);
   vec2 corner01 = vec2(corner01x, mod((vertex_id - corner01x) / 2.0, 2.0));
   return corner01;
}

void main() {
   vec2 corner01 = corner01_by_id(a_vertex_id);

   float u_line_width = u_line_info.x;
   int u_line_cap = int(u_line_info.y);

   float half_width = u_line_width / 2.0; // u_line_width: 4 => [-2, 2]

   vec2 p0 = a_xy0xy1.xy;
   vec2 p1 = a_xy0xy1.zw;
   vec2 h = p1 - p0;
   float h_len = length(h);
   vec2 h_dir = h / h_len;
   vec2 w_dir = cross(vec3(h_dir, 0), vec3(0, 0, 1)).xy;
   vec2 w = w_dir * u_line_width;

   float combined_cap_size = 0.0;
   if (u_line_cap != 0) { // if not butt
      combined_cap_size = u_line_width; // then square or round
   }

   // -

   // I fear The Right Thing To Do is to construct the stroke path from the
   // already-transformed points, then transform it yet again somehow.

   // PDF.pdf:
   // The line  width parameter specifies the thickness of the line used to stroke a path. It shall be a non-negative number  expressed  in  user  space  units;  stroking  a  path  shall  entail  painting  all  points  whose  perpendicular  distance from the path in user space is less than or equal to half the line width. The effect produced in device space depends on the current transformation matrix (CTM) in effect at the time the path is stroked. If the CTM specifies scaling by different factors in the horizontal and vertical dimensions, the thickness of stroked lines in device  space  shall  vary  according  to  their  orientation.

   // On our reference implementation, both scale and rotate, but not translate, affect stroking.
   // We need to do *something* with the non-translate coeffs.

   vec2 w_t = w;
   vec2 cap_h_t = h_dir * combined_cap_size;
   w_t = (u_transform * vec3(w_t, 0.0)).xy;
   cap_h_t = (u_transform * vec3(cap_h_t, 0.0)).xy;

   vec2 w_dir_t = (u_transform * vec3(w_dir, 0.0)).xy;

   w_t = (u_transform * vec3(w_t, 0.0)).xy;




   vec2 h_dir_t = (u_transform * vec3(h_dir, 0.0)).xy;
   vec3 cc = cross(vec3(normalize(w_dir_t), 0.0), vec3(normalize(h_dir_t), 0.0));
   vec2 cap_h_t = combined_cap_size * h_dir * length(cc);
   //vec2 cap_h_t = cross(vec3(w_dir_t, 0.0),
   //vec2 cap_h = h_dir * combined_cap_size;
   //vec2 cap_h_t = (u_transform * vec3(cap_h, 0.0)).xy;
   //cap_h_t = h_dir * dot(h_dir, cap_h_t);

   vec2 w_t = normalize(w_dir_t);
   w_t = (u_transform * vec3(w_t, 0.0)).xy; // This looks correct, but the ext

   cap_h_t = h_dir * combined_cap_size * length(w_t) * length(cc);

   w_t = normalize(w_t) * length(w_t) * u_line_width;
   //w_t *= u_line_width;

   // -

   //vec2 w_tt = (u_transform * vec3(w_t, 0.0)).xy;
   //w_tt = normalize(w_tt) * length(w_t);

   //vec2 cap_h = h_dir * dot(h_dir_t, h_dir);
   //vec2 cap_h = h_dir * combined_cap_size;

   vec2 cap_size_t = w_t + cap_h_t;

   p0 -= cap_size_t * 0.5;
   p1 += cap_size_t * 0.5;
   vec2 capped_h = p1 - p0 - w_t;

   // Col-major: [ w.x , capped_h.x, p0.x ]   [ corner.x ]
   //            [ w.y , capped_h.y, p0.y ] x [ corner.y ]
   //            [   0 ,          0,    1 ]   [        1 ]
   mat3 xy_from_wh = mat3(vec3(w_t, 0), vec3(capped_h, 0), vec3(p0, 1));
   vec3 xy_pos = xy_from_wh * vec3(corner01, 1);

   gl_Position = vec4(xy_pos.xy / u_canvas_size * 2.0 - 1.0, 0.0, 1.0);
   gl_Position.y *= -1.0;

   v_line_coord = vec2(-0.5*u_line_width, -combined_cap_size*0.5) +
                  corner01 * vec2(u_line_width, h_len + combined_cap_size);
   v_line_height = h_len;
}`.trim();
         const LINE_FS = `
precision mediump float;

uniform vec4 u_color;
uniform sampler2D u_dash_tex;
uniform vec4 u_line_info;

varying vec2 v_line_coord;
varying float v_line_height;

void main() {
   float u_line_width = u_line_info.x;
   int u_line_cap = int(u_line_info.y);
   float u_dash_length = u_line_info.z;
   float u_dash_offset = u_line_info.w;

   float dash_coord = (v_line_coord.y + u_dash_offset) / u_dash_length;
   dash_coord = mod(dash_coord, 1.0); // repeat
   float dash_dist_to_solid = texture2D(u_dash_tex, vec2(dash_coord, 0)).r * 255.0;

   float h_dist_to_solid = max(0.0 - v_line_coord.y, v_line_coord.y - v_line_height);
   h_dist_to_solid = max(h_dist_to_solid, dash_dist_to_solid);

   float dist_to_solid = h_dist_to_solid;
   float half_line_width = u_line_width/2.0;
   if (u_line_cap == 1) { // round
      dist_to_solid = length(vec2(v_line_coord.x, dist_to_solid));
      dist_to_solid = max(0.0, dist_to_solid - half_line_width);
   } else if (u_line_cap == 2) { // square
      dist_to_solid = max(0.0, dist_to_solid - half_line_width);
   }

   float solidness = max(0.0, 1.0 - dist_to_solid);
   solidness = max(0.1, 1.0 - dist_to_solid);
   gl_FragColor = vec4(0, 1, 0, 1);
   //if (solidness <= 0.0) discard;
   gl_FragColor = u_color * solidness;
}`.trim();
         this.rect_prog = linkProgramSources(gl, RECT_VS, TEX_FS, ['a_vertex_id', 'a_dest']);
         this.line_prog = linkProgramSources(gl, LINE_VS, LINE_FS, ['a_vertex_id', 'a_xy0xy1']);

         this._white_tex = create_nomip_texture(gl);
         gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, 1, 1, 0, GL.RGBA, GL.UNSIGNED_BYTE,
                       new Uint8Array([255, 255, 255, 255]));

         // -

         gl.disable(GL.DEPTH_TEST);
         gl.enable(GL.BLEND);

         // -

         {
            const ext = gl.getExtension('OES_vertex_array_object');
            gl.createVertexArray = function() { return ext.createVertexArrayOES(...arguments); };
            gl.bindVertexArray = function() { return ext.bindVertexArrayOES(...arguments); };
         }
         {
            const ext = gl.getExtension('ANGLE_instanced_arrays');
            gl.drawArraysInstanced = function() { ext.drawArraysInstancedANGLE(...arguments); };
            gl.vertexAttribDivisor = function() { ext.vertexAttribDivisorANGLE(...arguments); };
         }

         // -

         const box01_data = [
             0, 0,
             1, 0,
             0, 1,
             1, 1,
         ];
         this._vertex_id_vbo = gl.createBuffer();
         gl.bindBuffer(gl.ARRAY_BUFFER, this._vertex_id_vbo);
         this._ensure_vertex_id(4);

         // -
         this.blit_prog.name = 'blit_prog';
         this.blit_prog.vao = gl.createVertexArray();
         gl.bindVertexArray(this.blit_prog.vao);
         gl.enableVertexAttribArray(0);
         gl.vertexAttribPointer(0, 1, gl.UNSIGNED_SHORT, false, 0, 0);

         this.rect_prog.name = 'rect_prog';
         this.rect_prog.vao = gl.createVertexArray();
         gl.bindVertexArray(this.rect_prog.vao);
         gl.enableVertexAttribArray(0);
         gl.vertexAttribPointer(0, 1, gl.UNSIGNED_SHORT, false, 0, 0);
         gl.enableVertexAttribArray(1);
         //gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);

         this.line_prog.name = 'line_prog';
         this.line_prog.vao = gl.createVertexArray();
         gl.bindVertexArray(this.line_prog.vao);
         gl.enableVertexAttribArray(0);
         gl.vertexAttribPointer(0, 1, gl.UNSIGNED_SHORT, false, 0, 0);
         gl.enableVertexAttribArray(1);
         gl.vertexAttribDivisor(1, 1);
         //gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);

         gl.bindVertexArray(null);
      }

      _ensure_vertex_id(vert_count) {
         const gl = this.gl;

         if (vert_count > 0xffff) throw 'Too many verts per batch.';
         const vbo = this._vertex_id_vbo;
         if (vert_count <= vbo.max_verts) return;

         const data = new Uint16Array(vert_count);
         for (const i in data) {
            data[i] = i;
         }

         gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
         gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
         vbo.max_verts = data.length;
      }

      _set_prog(prog, transform) {
         transform = transform || this._state._transform;
         console.log(`_set_prog(${prog.name},`, transform, ')');
         const gl = this.gl;

         gl.useProgram(prog);
         gl.bindVertexArray(prog.vao);

         if (prog.u_transform && prog.last_transform !== transform) {
            prog.last_transform = transform;
            const mat3 = this._gl_transform(transform);
            console.log('uniformMatrix3fv(u_transform', mat3, ')');
            gl.uniformMatrix3fv(prog.u_transform, false, mat3);
         }

         const canvas_size = [this.canvas.width, this.canvas.height];
         if (prog.u_canvas_size && !array_equals(prog.last_canvas_size, canvas_size)) {
            prog.last_canvas_size = canvas_size;
            console.log('uniform2f(u_canvas_size', ...canvas_size, ')');
            gl.uniform2f(prog.u_canvas_size, ...canvas_size);
         }
      }

      get canvas() {
         return this.gl.canvas;
      }

      _reset() {
         const gl = this.gl;
         const c2d = this.c2d;
         c2d.canvas.width = gl.canvas.width;
         c2d.canvas.height = gl.canvas.height;

         gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

         this._clear_for_copy();

         this._state_stack = [];
         this._state = Object.assign({}, INITIAL_DRAW_STATE);
         this.resetTransform();
      }

      _clear_for_copy() {
         const gl = this.gl;
         gl.disable(GL.SCISSOR_TEST);
         gl.clearColor(0, 0, 0, 0);
         gl.clear(GL.COLOR_BUFFER_BIT);
      }

      _flush() {

      }

      // -

      save() {
         this._state_stack.push(this._state);
         this._state = Object.assign({}, this._state);
         this._state._transform = new DOMMatrix(this._state._transform);
      }

      restore() {
         if (!this._state_stack.length)
            return;
         this._state = this._state_stack.pop();
      }

      // -

      resetTransform() {
         this._state._transform = new DOMMatrix();
      }
      transform(a, b, c, d, e, f) {
         const m = new DOMMatrix([a, b, c, d, e, f]);
         this._state._transform = this._state._transform.multiply(m);
      }

      getTransform() {
         return new DOMMatrix(this._state._transform);
      }
      setTransform() {
         this.resetTransform();
         this.transform(...arguments);
      }

      rotate(cw_rads) {
         //const sin = Math.sin(-cw_rads)
         //const cos = Math.cos(-cw_rads);
         //this.transform(cos,sin, -sin,cos, 0,0);
         const deg = cw_rads / 2 / Math.PI * 360;
         this._state._transform = this._state._transform.rotate(deg);
      }
      scale(x, y) {
         //this.transform(x,0, 0,y, 0,0);
         this._state._transform = this._state._transform.scale(x, y);
      }
      translate(x, y) {
         //this.transform(1,0, 0,1, x,y);
         this._state._transform = this._state._transform.translate(x, y);
      }

      // -

      _gl_transform(m) {
         m = m || this._state._transform;

         const ret = new Float32Array([ // Column-major! (along the columns first)
            m.a,
            m.b,
            0,
            m.c,
            m.d,
            0,
            m.e,
            m.f,
            1,
         ]);
         return ret;
      }

      // -

      setLineDash(arr) {
         this._state._line_dash = arr.slice();
      }
      getLineDash() {
         return this._state._line_dash.slice();
      }

      // -

      measureText() {
         const c2d = this.c2d;
         c2d.font = this._state.font;
         c2d.textAlign = this._state.textAlign;
         c2d.textBaseline = this._state.textBaseline;
         return c2d.measureText(arguments);
      }

      createLinearGradient() {
         return this.c2d.createLinearGradient(arguments);
      }

      createRadialGradient() {
         return this.c2d.createRadialGradient(arguments);
      }

      // -

      _default_path = new Path2D();

      beginPath() {
         this._default_path = new Path2D();
      }

      // -

      lineTo() {
         this._default_path.lineTo(...arguments, this._state._transform);
      }
      moveTo() {
         this._default_path.moveTo(...arguments, this._state._transform);
      }
      rect() {
         this._default_path.rect(...arguments, this._state._transform);
      }

      arc() {
         this._default_path.arc(...arguments);
      }
      arcTo() {
         this._default_path.arcTo(...arguments);
      }
      bezierCurveTo() {
         this._default_path.bezierCurveTo(...arguments);
      }
      ellipse() {
         this._default_path.ellipse(...arguments);
      }
      quadraticCurveTo() {
         this._default_path.quadraticCurveTo(...arguments);
      }
      closePath() {
         this._default_path.closePath(...arguments);
      }
      quadraticCurveTo() {
         this._default_path.quadraticCurveTo(...arguments);
      }
      quadraticCurveTo() {
         this._default_path.quadraticCurveTo(...arguments);
      }
      quadraticCurveTo() {
         this._default_path.quadraticCurveTo(...arguments);
      }

      // -

      fill(a1, a2) {
         let fill_rule, path;
         if (a2 === undefined) {
            path = this._default_path;
            fill_rule = a1;
         } else {
            path = a1;
            fill_rule = a2;
         }

         fill_rule = fill_rule || 'nonzero';

         // -

         if (fill_rule == 'nonzero') {
            if (this._fill_fast()) return;
         }
         console.error('unimplemented');
      }

      stroke(path) {
         path = path || this._default_path;
         if (this._stroke_fast(path)) return;
         console.error('unimplemented');
      }

      // -

      /*
       * batch break on:
       *  * transform
       *  * color
       *  * program
       *  * lineCap/Dash/Offset
       */

      _fill_fast() {
         const cur_path = this._default_path;
         const rect_data = cur_path._rect_data();
         if (!rect_data) return false;

         // -

         const gl = this.gl;
         const prog = this.rect_prog;
         this._set_prog(prog);
         this._ensure_blend_op();

         const c2d = this.c2d;
         c2d.fillStyle = this.fillStyle;
         const color = parse_color(c2d.fillStyle);
         //console.log('_fill_rects: color: ', color);
         if (!color) throw new Error('Bad fillStyle: ' + this.fillStyle);

         color[0] *= this.globalAlpha;
         color[1] *= this.globalAlpha;
         color[2] *= this.globalAlpha;
         color[3] *= this.globalAlpha;

         gl.uniform4fv(prog.u_color, color);
         gl.uniform4f(prog.u_src_rect, 0, 0, 1, 1);
         gl.bindTexture(GL.TEXTURE_2D, this._white_tex);

         gl.clear(gl.DEPTH_BUFFER_BIT);
         gl.enable(gl.DEPTH_TEST);

         {
            const vbo = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
            gl.bufferData(gl.ARRAY_BUFFER, rect_data, gl.STREAM_DRAW);
            gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);

            const vert_count = rect_data.length / 2;
            this._ensure_vertex_id(vert_count);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, vert_count);

            gl.deleteBuffer(vbo);
         }

         gl.clear(gl.DEPTH_BUFFER_BIT);
         gl.disable(gl.DEPTH_TEST);
         return true;
      }

      // -

      _cached_tex_by_line_dash = {}

      _tex_by_line_dash() {
         const gl = this.gl;

         const arr = this.getLineDash();
         const key = arr.join(',');

         let tex = this._cached_tex_by_line_dash[key];
         if (!tex) {
            tex = this._cached_tex_by_line_dash[key] = create_nomip_texture(gl);
            let bytes;
            if (arr.length) {
               let dash_length = 0;
               for (const sublen of arr) {
                  dash_length += sublen;
               }
               bytes = new Uint8Array(dash_length);
               let pos = 0;
               let pen_down = true;
               for (const sublen of arr) {
                  const end = pos + sublen;
                  if (pen_down) {
                     bytes.fill(0, pos, end);
                     pos = end;
                  } else {
                     const last_solid_pos = pos-1;
                     const next_solid_pos = end;
                     for (; pos < end; ++pos) {
                        const dist = Math.min(pos - last_solid_pos, next_solid_pos - pos);
                        bytes[pos] = dist;
                     }
                  }
                  pen_down = !pen_down;
               }
            } else {
               bytes = new Uint8Array([0]);
            }
            //console.log(`_tex_by_line_dash: [${arr}] => [${bytes}]`);
            tex.dash_length = bytes.length;
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, tex.dash_length, 1, 0,
                          gl.LUMINANCE, gl.UNSIGNED_BYTE, bytes);
         }
         return tex;
      }

      _LINE_CAP_MODE_BY_STR = {
         'butt': 0,
         'round': 1,
         'square': 2,
      };

      _stroke_fast() {
         const cur_path = this._default_path;
         const line_data = cur_path._line_data();
         if (!line_data) return false;

         // -

         if (line_data._joins) {
            const line_cap = this.lineCap;
            const line_join = this.lineJoin;
            let can_join = (line_cap == "round" && line_join == "round");
            if (line_data._only_right_angles) {
               can_join |= (line_cap == 'square' && line_join == 'miter');
            }
            if (!can_join) {
               console.error(`Warning: Can't correctly join lines with lineCap:'${line_cap}', lineJoin:${line_join}':`, cur_path);
               //return false;
            }
         }

         // -

         const gl = this.gl;
         const prog = this.line_prog;
         this._set_prog(prog);
         this._ensure_blend_op();

         const dash_tex = this._tex_by_line_dash();
         gl.bindTexture(gl.TEXTURE_2D, dash_tex);

         const line_cap_mode = this._LINE_CAP_MODE_BY_STR[this.lineCap];
         if (line_cap_mode === undefined) throw new Error(`Bad lineCap: ${this.lineCap}`);

         gl.uniform4f(prog.u_line_info, this.lineWidth, line_cap_mode,
                      dash_tex.dash_length, this.lineDashOffset);

         const c2d = this.c2d;
         c2d.strokeStyle = this.strokeStyle;
         const color = parse_color(c2d.strokeStyle);
         //console.log('_fill_rects: color: ', color);
         if (!color) throw new Error('Bad strokeStyle: ' + this.strokeStyle);
         gl.uniform4fv(prog.u_color, color);

         gl.clear(gl.DEPTH_BUFFER_BIT);
         gl.enable(gl.DEPTH_TEST);

         {
            const vbo = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
            gl.bufferData(gl.ARRAY_BUFFER, line_data, gl.STREAM_DRAW);
            gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);

            const line_count = line_data.length / 4;
            console.log('line_data', line_data);
            gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, line_count);

            gl.deleteBuffer(vbo);
         }

         gl.clear(gl.DEPTH_BUFFER_BIT);
         gl.disable(gl.DEPTH_TEST);

         return true;
      }


      // -

      clip(a1, a2) {
         let fillRule, path;
         if (a2 === undefined) {
            path = this._default_path;
            fillRule = a1;
         } else {
            path = a1;
            fillRule = a2;
         }

         // -
         // fill stencil plane

         const gl = this.gl;

         let stencil_op;
         switch (fillRule) {
         case 'evenodd':
            stencil_op = gl.INVERT;
            break;

         case 'nonzero':
         default:
            stencil_op = gl.REPLACE;
            break;
         }

         gl.clear(gl.STENCIL_BUFFER_BIT);
         gl.colorMask(false, false, false, false);
         gl.stencilFunc(gl.ALWAYS, 1, 0);
         gl.stencilOp(stencil_op, stencil_op, stencil_op);

         this.fill(path, 'nonzero');

         // -
         // set stencil func/op for rendering

         gl.colorMask(true, true, true, true);
         gl.stencilFunc(gl.EQUALS, 1, 1);
         gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      }

      // -
/*
      createPattern(image, repetition) {
         repetition = repetition || 'repeat';

         const gl = this.gl;

         const tex = create_nomip_texture(gl);
         const width = image.width;
         const height = image.height;
         let border = 0;
         if (repetition == 'no-repeat') {
         gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA,
*/
      // -

      _cur_blend_op = undefined;

      _ensure_blend_op(blend_op) {
         blend_op = blend_op || this.globalCompositeOperation;
         if (blend_op == 'copy') {
            this._clear_for_copy();
         }
         if (blend_op === this._cur_blend_op) return;
         this._cur_blend_op = blend_op;

         const gl = this.gl;
         if (blend_op == 'source-over' ||
             blend_op == 'copy') {
            gl.blendEquation(gl.FUNC_ADD);
            //gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            return;
         }
         if (blend_op == 'destination-out') {
            gl.blendEquation(gl.FUNC_REVERSE_SUBTRACT);
            gl.blendFunc(gl.ONE, gl.ONE);
            return;
         }

         if (blend_op == 'source-in') {
            // C = Cs
            // A = As*Ad
            gl.blendEquation(gl.FUNC_ADD);
            gl.blendFuncSeparate(gl.ONE, gl.ZERO, gl.DST_ALPHA, gl.ZERO);
            return;
         }
         if (blend_op == 'destination-atop') {
            // C = Cd*Ad + Cs*(1-Ad)
            // A = As
            gl.blendEquation(gl.FUNC_ADD);
            gl.blendFuncSeparate(gl.ONE_MINUS_DST_ALPHA, gl.DST_ALPHA, gl.ONE, gl.ZERO);
            return;
         }
         if (blend_op == 'lighter') {
            gl.blendEquation(gl.FUNC_ADD);
            gl.blendFunc(gl.ONE, gl.ONE);
            return;
         }
         console.log('Unhandled blend_op: ', blend_op);
      }

      // -

      fillText(text, x, y, max_width) {
         this._put_text('fill', text, x, y, max_width);
      }
      strokeText(text, x, y, max_width) {
         this._put_text('stroke', text, x, y, max_width);
      }

      _make_text(type, text, x, y, max_width) {
         //console.log(`_put_text(${[].slice.call(arguments)})`);
         const c2d = this.c2d;
         const gl = this.gl;
         //console.log(`_put_text: font: ${c2d.font}`);

         // -
         // Measure-text

         c2d.font = this.font;
         c2d.textAlign = this.textAlign;
         c2d.textBaseline = this.textBaseline;
         const meas = c2d.measureText(text);

         // first: align:left, baseline:middle
         if (meas.actualBoundingBoxAscent === undefined) {
            // Guess time
            const em = c2d.measureText('M').width;
            const height = em * 1.5;
            switch (this.textBaseline) {
               case 'top':
                  meas.actualBoundingBoxAscent = 0;
                  break;
               case 'middle':
                  meas.actualBoundingBoxAscent = em / 2;
                  break;
               case 'alphabetic':
               case 'ideographic':
                  meas.actualBoundingBoxAscent = em;
                  break;
               case 'bottom':
                  meas.actualBoundingBoxAscent = height;
                  break;
            }
            meas.actualBoundingBoxDescent = height - meas.actualBoundingBoxAscent;
         }
         meas.height = meas.actualBoundingBoxAscent + meas.actualBoundingBoxDescent;
         //console.log('meas', meas);

         // -
         // put (composite:copy) on intermediary (cached?) canvas
         c2d.canvas.width = meas.width;
         c2d.canvas.height = meas.height; // This resets, so reset font et al

         c2d.font = this.font;
         c2d.textAlign = this.textAlign;
         c2d.textBaseline = this.textBaseline;

         c2d.globalCompositeOperation = 'copy';
         c2d.globalAlpha = 1.0;
         c2d.fillStyle = this.fillStyle;
         c2d.strokeStyle = this.strokeStyle;

         let func = c2d.fillText;
         if (type === 'stroke') {
            func = c2d.strokeText;
         }
         func.call(c2d, text, 0, meas.actualBoundingBoxAscent, max_width);

         // -
         // this.drawImage
         //const image = make_gl_image(this.gl, c2d.canvas, 0, meas.actualBoundingBoxAscent);
         const tex = create_nomip_texture(gl);

         gl.pixelStorei(GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
         gl.texImage2D(GL.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c2d.canvas);
         gl.pixelStorei(GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

         tex.width = meas.width;
         tex.height = meas.height;
         tex.y_offset = meas.actualBoundingBoxAscent;
         return tex;
      }

      _put_text(type, text, x, y, max_width) {
         const c2d = this.c2d;
         let key = {
            font: c2d.font,
            textAlign: c2d.textAlign,
            textBaseline: c2d.textBaseline,
            type: type,
            max_width: max_width,
            text: text,
         };
         key = JSON.stringify(key);
         //console.log('key', key);

         let tex = this._tex_cache[key];
         let should_update = false;
         if (!tex) {
            tex = this._tex_cache[key] = this._make_text(...arguments);
         }

         const d_rect = {
            x: x,
            y: y - tex.y_offset,
            w: tex.width,
            h: tex.height,
         };
         //console.log(d_rect);

         // -

         this._draw_tex_rect(tex, null, d_rect);
      }

      // -

      fillRect(x, y, w, h) {
         const cur_path = this._default_path;
         this.beginPath();
         this.rect(x, y, w, h);
         this.fill();
         this._default_path = cur_path;
      }

      strokeRect(x, y, w, h) {
         const cur_path = this._default_path;
         this.beginPath();
         this.rect(x, y, w, h);
         this.stroke();
         this._default_path = cur_path;
      }

      clearRect(x, y, w, h) {
         this.save();
         this.fillStyle = 'white';
         this.globalCompositeOperation = 'destination-out';
         this.fillRect(x, y, w, h);
         this.restore();
      }

      getImageData(x, y, w, h) {
         const c2d = this.c2d;
         const gl = this.gl;
         const canvas = gl.canvas;

         const gl_rect = make_rect(arguments);
         abs_rect(gl_rect);
         flip_y(gl_rect, gl.canvas.height);

         const p = new Uint8Array(gl_rect.w * gl_rect.h * 4);
         gl.readPixels(gl_rect.x, gl_rect.y, gl_rect.w, gl_rect.h, gl.RGBA, gl.UNSIGNED_BYTE, p);

         const idata = c2d.createImageData(w, h);
         const bytes_per_row = 4*gl_rect.w;
         for (let gl_row = 0; gl_row < gl_rect.h; ++gl_row) { // y-flip :) -> :(
            const gl_start = bytes_per_row*gl_row;
            const id_start = bytes_per_row*(gl_rect.h - 1 - gl_row);
            idata.data.set(p.subarray(gl_start, gl_start + bytes_per_row), id_start);
         }
         return idata;
      }
/*
      putImageData(idata, dstX, dstY, srcX, srcY, w, h) {
         if (!idata.tex_by_canvas) {
            idata.tex_by_canvas = {};
         }
         if (!idata.tex_by_canvas[obj_id(this)]) {
            const gl = this.gl;
            idata.tex_by_canvas[obj_id(this)] = create_nomip_texture(gl);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, idata);
         }
         const tex = idata.tex_by_canvas[obj_id(this)];
         const fetchMatrix = make_fetch_mat(idata.width, idata.height,
      }
      */

      _tex_cache = {};

      drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh) {
         const gl = this.gl;
         const src_w = src.naturalWidth || src.videoWidth || src.width;
         const src_h = src.naturalHeight || src.videoHeight || src.height;

         if (dx === undefined) {
            dx = sx;
            dy = sy;
            dw = sw;
            dh = sh;

            sx = 0;
            sy = 0;
            sw = src_w;
            sh = src_h;
         }
         if (dw === undefined) {
            dw = sw;
            dh = sh;
         }

         // -

         const src_id = obj_id(src);

         let tex = this._tex_cache[src_id];
         let should_update = false;
         if (!tex) {
            tex = this._tex_cache[src_id] = create_nomip_texture(gl);
            should_update = true;
         } else {
            if (src._is_static === undefined) {
               src._is_static = false; // Video/Canvas

               if (src instanceof HTMLImageElement) {
                  src._is_static = true; // Even gifs always pick the first frame

                  src.addEventListener('load', e => {
                     src._is_static = undefined;
                  }, {
                     capture: false,
                     once: true,
                  });
               }
            }
            should_update = !src._is_static;
         }

         if (should_update) {
            gl.pixelStorei(GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            gl.texImage2D(GL.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
            gl.pixelStorei(GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
         }

         const s_norm_rect = {
            x: sx / src_w,
            y: sy / src_h,
            w: sw / src_w,
            h: sh / src_h,
         };
         const d_rect = {
            x: dx,
            y: dy,
            w: dw,
            h: dh,
         };

         // -

         this._draw_tex_rect(tex, s_norm_rect, d_rect);
      }

      /* _draw_tex_rect callers:
       * * drawImage
       * * fillText/strokeText
       * * putImageData
       */
      _draw_tex_rect(tex, s_norm_rect, d_rect) {
         s_norm_rect = s_norm_rect || {
            x: 0, y: 0,
            w: 1, h: 1,
         };

         const gl = this.gl;

         const prog = this.rect_prog;
         gl.useProgram(prog);
         gl.uniform4f(prog.u_color, this.globalAlpha, this.globalAlpha,
                      this.globalAlpha, this.globalAlpha);
         gl.uniform4f(prog.u_src_rect, s_norm_rect.x, s_norm_rect.y,
                      s_norm_rect.w, s_norm_rect.h);
         gl.bindTexture(GL.TEXTURE_2D, tex);

         this._ensure_blend_op();
         this._set_prog(prog);

         // -

         const path = new Path2D();
         path.rect(x, y, w, h, this._state._transform);

         const rect_data = path._rect_data();

         // -

         gl.bindVertexArray(prog.vao);
         const vbo = gl.createBuffer();
         gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
         gl.bufferData(gl.ARRAY_BUFFER, rect_data, gl.STREAM_DRAW);
         gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);

         gl.drawArrays(gl.TRIANGLE_STRIP, 0, rect_data.length / 2);

         gl.deleteBuffer(vbo);
      }
   }

   const orig_get_context = HTMLCanvasElement.prototype.getContext;
   HTMLCanvasElement.prototype.getContext = function(type, options) {
      let ret = null;
      const default_options = {
         webgl: window.OVERRIDE_2D,
      };
      options = options || default_options;
      if (type == '2d' && options.webgl) {
         options = Object.assign({
            alpha: true,
            antialias: true,
            depth: true,
            stencil: true,
            preserveDrawingBuffer: true,
            premultipliedAlpha: true,
         }, options);
         const gl_canvas = this;
         const gl = orig_get_context.call(gl_canvas, 'webgl', options);
         if (!gl)
            return null;

         ret = new CanvasRenderingContextGL2D(gl);
         console.error('FYI: new CanvasRenderingContextGL2D:', ret);
      }
      if (!ret) {
         ret = orig_get_context.apply(this, arguments);
      }
      this._gl2d_context = ret;
      return ret;
   };
})();
