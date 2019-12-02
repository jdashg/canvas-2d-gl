(() => {
   const GL = WebGLRenderingContext;

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

   function vec_dot(a, b) {
      var ret = 0;
      if (a.length !== b.length) throw new Error(`${a.length} !== ${b.length}`);
      for (var i = 0; i < a.length; i++) {
         ret += a[i]*b[i];
      }
      return ret;
   }

   function mat_row(m, row) {
      return m[row];
   }

   function mat_col(m, col) {
      let ret = [];
      for (var i = 0; i < m.length; i++) {
         ret.push(m[i][col]);
      }
      return ret;
   }

   function mat_mul(a, b) {
      const ret = [];
      for (let y = 0; y < a.length; y++) {
         const row = [];
         for (let x = 0; x < b[0].length; x++) {
            const val = vec_dot(mat_row(a, y), mat_col(b, x));
            row.push(val);
         }
         ret.push(row);
      }
      return ret;
   }

   function mat_mul_vec(a, b) {
      b = [b];
      b = mat_trans(b);
      return mat_mul(a, b);
   }

   function mat_string(m, precision) {
      precision = precision || 5;
      const rows = [];
      for (let i = 0; i < m.length; i++) {
         if (m[i].length !== m[0].length) throw new Error(`${m[i].length} !== ${m[0].length}`);
         const row = mat_row(m, i);
         const format = function(x) {
            let str = x.toFixed(precision);
            if (str[0] != '-')
               str = ' ' + str;
            return str;
         };
         const row_strs = row.map(format);
         const row_str = row_strs.join(',');
         rows.push(row_str);
      }
      const rows_str = '[' + rows.join(',\n ') + ' ]';
      return rows_str;
   }

   function mat_trans(m) {
      const n = m[0].length;
      const ret = [];
      for (let i = 0; i < n; i++) {
         ret.push(mat_col(m, i));
      }
      return ret;
   }

   function mat_ident(m_rows, n_cols) {
      n_cols = n_cols || m_rows;

      const ret = [];
      for (let y = 0; y < m_rows; y++) {
         const row = [];
         for (let x = 0; x < n_cols; x++) {
            let val = 0;
            if (x == y) {
               val = 1;
            }
            row.push(val);
         }
         ret.push(row);
      }
      return ret;
   }

   // -

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


   const COLOR_BY_NAME = {
      transparent: [0, 0, 0, 0],
      black: [0, 0, 0, 1],
      white: [1, 1, 1, 1],
   };

   function parse_color(fill_style_str) {
      let color = COLOR_BY_NAME[fill_style_str];
      if (color) return color;

      if (fill_style_str[0] == '#') {
         const str = fill_style_str.substring(1);
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
      const m = fill_style_str.match(re_rgba);
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

      return null;
   }

   const DRAW_STATE = {
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
      _path                   : [],
   };

   const DEFAULT_TRANSFORM = mat_ident(2, 3);

   class CanvasRenderingContextGL2D {
      constructor(gl) {
         const c2d_canvas = document.createElement('canvas');
         c2d_canvas.width = gl.canvas.width;
         c2d_canvas.height = gl.canvas.height;
         const c2d = c2d_canvas.getContext('2d');

         this.gl = gl;
         this.c2d = c2d;

         const gl2d = this;

         hook_prop(gl.canvas, 'width', {
            set: function(x, orig_fn) {
               orig_fn.call(gl.canvas, x);
               gl2d._reset();
            }
         });
         hook_prop(gl.canvas, 'height', {
            set: function(x, orig_fn) {
               orig_fn.call(gl.canvas, x);
               gl2d._reset();
            }
         });

         for (const k in DRAW_STATE) {
            if (k[0] == '_')
               continue;
            Object.defineProperty(this, k, {
               enumerable: true,
               get: function() { return gl2d._state[k]; },
               set: function(val) { gl2d._state[k] = val; },
            });
         }

         this._reset();

         // -

         const BLIT_VS = `
attribute vec2 a_vert;
uniform vec4 u_dest_rect;
uniform vec4 u_tex_rect;
varying vec2 v_tex_coord;

void main() {
   vec2 dest_pos = u_dest_rect.xy + a_vert * u_dest_rect.zw;
   gl_Position = vec4(dest_pos * 2.0 - 1.0, 0.0, 1.0);
   v_tex_coord = u_tex_rect.xy + a_vert * u_tex_rect.zw;
}`.trim();
         const BLIT_FS = `
precision mediump float;

uniform sampler2D u_tex;
varying vec2 v_tex_coord;

void main() {
    gl_FragColor = texture2D(u_tex, v_tex_coord);
}`.trim();
         this.blit_prog = linkProgramSources(gl, BLIT_VS, BLIT_FS, ['a_vert']);

         // -

         const RECT_VS = `
attribute vec2 a_box01;
attribute vec4 a_dest_rect;
uniform mat3 u_transform;

void main() {
   vec2 dest2 = a_dest_rect.xy + a_box01 * a_dest_rect.zw;
   vec3 dest3 = u_transform * vec3(dest2, 1);
   gl_Position = vec4(dest3.xy * 2.0 - 1.0, 0.0, 1.0);
   gl_Position.y *= -1.0;
}`.trim();
         const COLOR_VS = `
precision mediump float;

uniform vec4 u_color;

void main() {
    gl_FragColor = u_color;
}`.trim();
         this.rect_prog = linkProgramSources(gl, RECT_VS, COLOR_VS, ['a_box01', 'a_dest_rect']);
/*
         const LINE_VS = `
attribute vec2 a_box01;
attribute vec4 a_dest_rect;
uniform mat3 u_transform;

void main() {
   vec2 dest2 = a_dest_rect.xy + a_box01 * a_dest_rect.zw;
   vec3 dest3 = u_transform * vec3(dest2, 1);
   gl_Position = vec4(dest3.xy * 2.0 - 1.0, 0.0, 1.0);
   gl_Position.y *= -1.0;
}`.trim();
         this.line_prog = linkProgramSources(gl, LINE_VS, COLOR_VS, ['a_box01', 'a_dest_rect']);
*/
         // -

         const vao_ext = gl.getExtension('OES_vertex_array_object');
         gl.createVertexArray = function() { return vao_ext.createVertexArrayOES(); };
         gl.bindVertexArray = function(vao) { return vao_ext.bindVertexArrayOES(vao); };

         this.blit_vao = gl.createVertexArray();
         gl.bindVertexArray(this.blit_vao);

         const vertData = [
             0, 0,
             1, 0,
             0, 1,
             1, 1,
         ];
         const vbo = gl.createBuffer();
         gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
         gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertData), gl.STATIC_DRAW);

         const instancing_ext = gl.getExtension('ANGLE_instanced_arrays');
         gl.drawArraysInstanced = function(...args) {
            instancing_ext.drawArraysInstancedANGLE(...args);
         };

         gl.enableVertexAttribArray(0);
         gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

         gl.enableVertexAttribArray(1);
         instancing_ext.vertexAttribDivisorANGLE(1, 1);

         //gl.bindVertexArray(null);
      }

      _ensure_prog_transform(prog, transform) {
         const gl = this.gl;
         if (transform === undefined) throw new Error('`transform` required.');
         if (prog.last_transform === transform) return;
         prog.last_transform = transform;
         const mat3 = this._gl_transform(transform);
         console.log('_ensure_prog_transform: mat3:', mat3);
         gl.uniformMatrix3fv(prog.u_transform, false, mat3);
      }

      get canvas() {
         return this.gl.canvas;
      }

      _reset() {
         const gl = this.gl;
         const c2d = this.c2d;
         c2d.canvas.width = gl.canvas.width;
         c2d.canvas.height = gl.canvas.height;

         c2d.globalAlpha = 1.0;
         c2d.globalCompositeOperation = 'copy';

         gl.disable(GL.SCISSOR_TEST);
         gl.disable(GL.DEPTH_TEST);
         gl.clearColor(0, 0, 0, 0);
         gl.clear(GL.COLOR_BUFFER_BIT);
         gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

         this._state_stack = [];
         this._state = Object.assign({}, DRAW_STATE);
      }

      _draw_quad() {
         const gl = this.gl;
         gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }

      // -

      save() {
         this._state_stack.push(this._state);
         this._state = Object.assign({}, this._state);
         this._state._path = this._state._path.slice();
      }

      restore() {
         if (!this._state_stack.length)
            return;
         this._state = this._state_stack.pop();
      }

      // -

      transform(a, b, c, d, e, f) {
         let cur = this._state._transform;
         if (!cur) {
            cur = mat_ident(2, 3);
         }
         const m = [[a, c, e],
                    [b, d, f],
                    [0, 0, 1]];
         this._state._transform = mat_mul(cur, m);
      }

      setTransform(a, b, c, d, e, f) {
         this._state._transform = null;
         this.transform(a, b, c, d, e, f);
      }
      rotate(cw_rads) {
         const sin = Math.sin(-cw_rads)
         const cos = Math.cos(-cw_rads);
         this.transform(cos,sin, -sin,cos, 0,0);
      }
      scale(x, y) {
         this.transform(x,0, 0,y, 0,0);
      }
      translate(x, y) {
         this.transform(1,0, 0,1, x,y);
      }

      // -

      setLineDash(arr) {
         this._state._line_dash = arr.slice();
      }
      getLineDash() {
         return this._state._line_dash.slice();
      }

      _gl_transform(rows) {
         if (rows === undefined) {
            rows = this._state._transform;
         }
         if (!rows) {
            rows = DEFAULT_TRANSFORM;
         }
         const kx = 1/this.canvas.width;
         const ky = 1/this.canvas.height;
         const scale_mat = [[kx, 0],
                            [0, ky]];
         console.log('scale_mat', JSON.stringify(scale_mat));
         console.log('rows', JSON.stringify(rows));
         const scaled_rows = mat_mul(scale_mat, rows);

         const ret = new Float32Array(9);
         ret[0] = scaled_rows[0][0];
         ret[1] = scaled_rows[1][0];
         ret[2] = 0;
         ret[3] = scaled_rows[0][1];
         ret[4] = scaled_rows[1][1];
         ret[5] = 0;
         ret[6] = scaled_rows[0][2];
         ret[7] = scaled_rows[1][2];
         ret[8] = 1;
         return ret;
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


      beginPath() {
         this._state._path = [];
      }

      _path_add(func, args) {
         this._state._path.push({
            func: func,
            args: [].slice.call(args),
            transform: this._state._transform,
         });
      }

      _path_replay() {
         const c2d = this.c2d;
         const cur_path = this._state._path;
         let last_transform;
         c2d.beginPath();
         for (const call of cur_path) {
            if (call.transform !== last_transform) {
               last_transform = call.transform;
               if (call.transform) {
                  c2d.setTransform(last_transform[0], last_transform[1], last_transform[2],
                                   last_transform[3], last_transform[4], last_transform[5]);
               } else {
                  c2d.setTransform(1, 0, 0, 1, 0, 0);
               }
            }
            c2d[call.func].apply(c2d, call.args);
         }
      }

      // -

      arc() {
         this._path_add('arc', arguments);
      }
      arcTo() {
         this._path_add('arcTo', arguments);
      }
      bezierCurveTo() {
         this._path_add('bezierCurveTo', arguments);
      }
      closePath() {
         this._path_add('closePath', arguments);
      }
      ellipse() {
         this._path_add('ellipse', arguments);
      }
      lineTo() {
         this._path_add('lineTo', arguments);
      }
      moveTo() {
         this._path_add('moveTo', arguments);
      }
      quadraticCurveTo() {
         this._path_add('quadraticCurveTo', arguments);
      }
      rect() {
         this._path_add('rect', arguments);
      }

      // -

      _path_float_buf = new Float32Array(0);

      _fill_rects(rect_floats, transform) {
         const fill_style = this.fillStyle;
         const color = parse_color(fill_style);
         console.log('_fill_rects: color: ', color);
         if (!color) throw new Error('Bad fill_style: ' + fill_style);

         const gl = this.gl;
         const prog = this.rect_prog;
         gl.useProgram(prog);
         this._ensure_prog_transform(prog, transform);

         gl.disable(gl.BLEND); // todo
         gl.uniform4f(prog.u_color, color[0],
                                    color[1],
                                    color[2],
                                    color[3]);

         const vbo = gl.createBuffer();
         gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
         gl.bufferData(gl.ARRAY_BUFFER, rect_floats, gl.STREAM_DRAW);
         gl.enableVertexAttribArray(1);
         gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);

         const quad_count = rect_floats.length / 4;
         gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, quad_count);
         gl.deleteBuffer(vbo);
      }

      fill() {
         const cur_path = this._state._path;

         const float_count = cur_path.length*4;
         if (!float_count) return; // Ok, sure!

         if (this._path_float_buf.length < float_count) {
            this._path_float_buf = new Float32Array(float_count);
         }
         const buf = this._path_float_buf;


         const common_transform = cur_path[0].transform;
         let fast_rects = true;
         let float_pos = 0;
         for (const cur of cur_path) {
            fast_rects &= (cur.func === 'rect' &&
                           cur.transform === common_transform);
            if (!fast_rects) {
               console.log("Can't fast-path: " + JSON.stringify(cur));
               break;
            }
            buf[float_pos+0] = cur.args[0];
            buf[float_pos+1] = cur.args[1];
            buf[float_pos+2] = cur.args[2];
            buf[float_pos+3] = cur.args[3];
            float_pos += 4;
         }
         if (!fast_rects) return;

         this._fill_rects(buf.subarray(0, float_count), common_transform);
      }

      // -

      rect_to_gl(rect) {
         y = this.gl.canvas.height - y - h; // flip y
         return {x:x, y:y, w:w, h:h};
      }
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


      /* globalCompositeOperation:
         * source-over: blendEquation(ADD); blendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA);
         * source-in:
            * C = Cs
            * A = As*Ad
            * blendEquation(ADD)
            * blendFuncSep(ONE, ZERO, DST_ALPHA, ZERO);
         * destination-out: blendEquation(REVERSE_SUBTRACT); blendFunc(SRC_ALPHA, ONE);
         * destination-atop:
            * C = Cd*Ad + Cs*(1-Ad)
            * A = As
            * blendEquation(ADD)
            * blendFuncSep(ONE_MINUS_DST_ALPHA, DST_ALPHA, ONE, ZERO);
         * lighter: blendFunc(ONE, ONE); blendEquation(ADD);
       */

      fillRect(x, y, w, h) {
         this._fillRect(x, y, w, h, this._state.fillStyle, this._state.globalCompositeOperation);
      }

      clearRect(x, y, w, h) {
         this._fillRect(x, y, w, h, 'transparent', 'copy');
      }

      _fillRect(x, y, w, h, fill_style, blend_op) {
         const c2d = this.c2d;
         const gl = this.gl;

         const rect = make_rect(arguments);
         const gl_rect = Object.assign({}, rect);
         abs_rect(gl_rect);
         flip_y(gl_rect, gl.canvas.height);

         const is_color_fill = ((typeof fill_style) == 'string');

         const fastpath = (() => {
            if (!is_color_fill) {
               console.log('!is_color_fill');
               return false;
            }

            if (this._state._transform) {
               console.log('this._state._transform');
               return false;
            }

            const TRIVIAL_COMPOSITES = [
               'source-over',
               'copy',
               'hard-light',
            ];
            if (!TRIVIAL_COMPOSITES.includes(blend_op)) {
               console.log(`!TRIVIAL_COMPOSITES.includes(${blend_op})`);
               return false;
            }

            function dist_to_int(x) {
               return Math.abs(x - Math.round(x));
            }
            let err = 0;
            err += dist_to_int(gl_rect.x);
            err += dist_to_int(gl_rect.y);
            err += dist_to_int(gl_rect.w);
            err += dist_to_int(gl_rect.h);
            if (err >= 0.1) {
               console.log('non-pixel-aligned');
               return false;
            }

            return true;
         })();
         if (fastpath) {
            let color = parse_color(fill_style);
            console.log('fastpath color', color);
            if (!color) {
               c2d.fillStyle = fill_style;
               c2d.fillRect(0, 0, 1, 1);
               color = c2d.getImageData(0, 0, 1, 1).data;
               color = [].map.call(color, x => x / 255.0);
            }
            color = color.map(x => x * this._state.globalAlpha);

            gl.enable(gl.SCISSOR_TEST);
            gl.scissor(gl_rect.x, gl_rect.y, gl_rect.w, gl_rect.h);
            gl.clearColor(color[0], color[1], color[2], color[3]);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.disable(gl.SCISSOR_TEST);
            return;
         }

         // -

         let src_w = w;
         let src_h = h;
         if (is_color_fill) {
            src_w = 1;
            src_h = 1;
         }
         c2d.fillStyle = fill_style;
         c2d.globalCompositeOperation = blend_op;
         c2d.fillRect(x, y, src_w, src_h);
         const idata = c2d.getImageData(x, y, src_w, src_h);

         if (is_color_fill) {
            const color = parse_color(fill_style);
            console.log('color', color);
            if (!color) throw new Error('Bad fill_style: ' + fill_style);

            const gl = this.gl;
            const prog = this.fill_prog;
            gl.useProgram(prog);
            gl.disable(gl.BLEND);
            gl.uniform4f(prog.u_color, color[0],
                                       color[1],
                                       color[2],
                                       color[3]);

            const norm_rect = Object.assign({}, rect);
            scale_rect(norm_rect, 1.0 / gl.canvas.width, 1.0 / gl.canvas.height);
            console.log('norm_rect', norm_rect);
            gl.disableVertexAttribArray(1);
            gl.vertexAttrib4f(1, norm_rect.x, norm_rect.y,
                                 norm_rect.w, norm_rect.h);

            prog.ensure_transform();
            this._draw_quad();
            return;
         }

         console.log('fillRect non-color-fill not implemented');
         return;
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
         for (let gl_row = 0; gl_row < gl_rect.h; ++gl_row) { // yflip
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
   }

   const orig_get_context = HTMLCanvasElement.prototype.getContext;
   HTMLCanvasElement.prototype.getContext = function(type, attribs) {
      if (type == 'gl-2d') {
         attribs = attribs || {
            alpha: true,
            depth: true,
            stencil: true,
            preserveDrawingBuffer: true,
            premultipliedAlpha: false,
         };
         const gl_canvas = this;
         const gl = orig_get_context.call(gl_canvas, 'webgl', attribs);
         if (!gl)
            return null;

         return new CanvasRenderingContextGL2D(gl);
      }
      return orig_get_context.apply(this, arguments);
   };
})();
