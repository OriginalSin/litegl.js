/**
* Indexer used to reuse vertices among a mesh
* @class Indexer
* @constructor
*/
GL.Indexer = function Indexer() {
  this.unique = [];
  this.indices = [];
  this.map = {};
}
GL.Indexer.prototype = {
	add: function(obj) {
    var key = JSON.stringify(obj);
    if (!(key in this.map)) {
      this.map[key] = this.unique.length;
      this.unique.push(obj);
    }
    return this.map[key];
  }
};

/**
* A data buffer to be stored in the GPU
* @class Buffer
* @constructor
* @param {String} target gl.ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER
* @param {ArrayBufferView} data the data in typed-array format
* @param {number} spacing number of numbers per component (3 per vertex, 2 per uvs...), default 3
* @param {enum} stream_type default gl.STATIC_DRAW (other: gl.DYNAMIC_DRAW, gl.STREAM_DRAW 
*/
global.Buffer = GL.Buffer = function Buffer(target, data, spacing, stream_type, gl) {
	gl = gl || global.gl;
	this.buffer = null; //webgl buffer
	this.target = target;
	this.gl = gl;

	//optional
	this.data = data;
	this.spacing = spacing || 3;

	if(this.data)
		this.upload(stream_type);
}

/**
* Applies an action to every vertex in this buffer
* @method forEach
* @param {function} callback to be called for every vertex (or whatever is contained in the buffer)
*/
GL.Buffer.prototype.forEach = function(callback)
{
	var d = this.data;
	for (var i = 0, s = this.spacing, l = d.length; i < l; i += s)
	{
		callback(d.subarray(i,i+s),i);
	}
	return this; //to concatenate
}

/**
* Applies a mat4 transform to every triplets in the buffer (assuming they are points)
* No upload is performed (to ensure efficiency in case there are several operations performed
* @method applyTransform
* @param {mat4} mat
*/
GL.Buffer.prototype.applyTransform = function(mat)
{
	var d = this.data;
	for (var i = 0, s = this.spacing, l = d.length; i < l; i += s)
	{
		var s = d.subarray(i,i+s);
		vec3.transformMat4(s,s,mat);
	}
	return this; //to concatenate
}

/**
* Uploads the buffer data (stored in this.data) to the GPU
* @method upload
* @param {number} stream_type default gl.STATIC_DRAW (other: gl.DYNAMIC_DRAW, gl.STREAM_DRAW 
*/
GL.Buffer.prototype.upload = function(stream_type) { //default gl.STATIC_DRAW (other: gl.DYNAMIC_DRAW, gl.STREAM_DRAW )
	var spacing = this.spacing || 3; //default spacing	
	var gl = this.gl;

	if(!this.data)
		throw("No data supplied");

	var data = this.data;
	if(!data.buffer)
		throw("Buffers must be typed arrays");

	//I store some stuff inside the WebGL buffer instance, it is supported
	this.buffer = this.buffer || gl.createBuffer();
	this.buffer.length = data.length;
	this.buffer.spacing = spacing;

	//store the data format
	switch( data.constructor )
	{
		case Int8Array: this.buffer.gl_type = gl.BYTE; break;
		case Uint8ClampedArray: 
		case Uint8Array: this.buffer.gl_type = gl.UNSIGNED_BYTE; break;
		case Int16Array: this.buffer.gl_type = gl.SHORT; break;
		case Uint16Array: this.buffer.gl_type = gl.UNSIGNED_SHORT; break;
		case Int32Array: this.buffer.gl_type = gl.INT; break;
		case Uint32Array: this.buffer.gl_type = gl.UNSIGNED_INT; break;
		case Float32Array: this.buffer.gl_type = gl.FLOAT; break;
		default: throw("unsupported buffer type");
	}

	gl.bindBuffer(this.target, this.buffer);
	gl.bufferData(this.target, data , stream_type || this.stream_type || gl.STATIC_DRAW);
};
//legacy
GL.Buffer.prototype.compile = GL.Buffer.prototype.upload;


/**
* Uploads part of the buffer data (stored in this.data) to the GPU
* @method uploadRange
* @param {number} start offset in bytes
* @param {number} size sizes in bytes
*/
GL.Buffer.prototype.uploadRange = function(start, size) {
	if(!this.data)
		throw("No data stored in this buffer");

	var data = this.data;
	if(!data.buffer)
		throw("Buffers must be typed arrays");

	var view = new Uint8Array( this.data.buffer, start, size );

	var gl = this.gl;
	gl.bindBuffer(this.target, this.buffer);
	gl.bufferSubData(this.target, start, view );
};



/**
* Mesh class to upload geometry to the GPU
* @class Mesh
* @param {Object} vertexBuffers object with all the vertex streams
* @param {Object} indexBuffers object with all the indices streams
* @param {Object} options
* @param {WebGLContext} gl [Optional] gl context where to create the mesh
* @constructor
*/
global.Mesh = GL.Mesh = function Mesh(vertexbuffers, indexbuffers, options, gl)
{
	gl = gl || global.gl;
	this.gl = gl;

	//used to avoid problems with resources moving between different webgl context
	this._context_id = gl.context_id; 

	this.vertexBuffers = {};
	this.indexBuffers = {};

	if(vertexbuffers || indexbuffers)
		this.addBuffers(vertexbuffers, indexbuffers);

	if(options)
		for(var i in options)
			this[i] = options[i];
};

Mesh.common_buffers = {
	"vertices": { spacing:3, attribute: "a_vertex"},
	"vertices2D": { spacing:2, attribute: "a_vertex2D"},
	"normals": { spacing:3, attribute: "a_normal"},
	"coords": { spacing:2, attribute: "a_coord"},
	"coords1": { spacing:2, attribute: "a_coord1"},
	"coords2": { spacing:2, attribute: "a_coord2"},
	"colors": { spacing:4, attribute: "a_color"}, 
	"tangents": { spacing:3, attribute: "a_tangent"},
	"bone_indices": { spacing:4, attribute: "a_bone_indices", type: Uint8Array },
	"weights": { spacing:4, attribute: "a_weights"},
	"extra": { spacing:1, attribute: "a_extra"},
	"extra2": { spacing:2, attribute: "a_extra2"},
	"extra3": { spacing:3, attribute: "a_extra3"},
	"extra4": { spacing:4, attribute: "a_extra4"}
};

Mesh.default_datatype = Float32Array;


/**
* Adds buffer to mesh
* @method addBuffer
* @param {string} name
* @param {Buffer} buffer 
*/

Mesh.prototype.addBuffer = function(name, buffer)
{
	if(buffer.target == gl.ARRAY_BUFFER)
		this.vertexBuffers[name] = buffer;
	else
		this.indexBuffers[name] = buffer;

	if(!buffer.attribute)
		buffer.attribute = GL.Mesh.common_buffers[name].attribute;
}


/**
* Adds vertex and indices buffers to a mesh
* @method addBuffers
* @param {Object} vertexBuffers object with all the vertex streams
* @param {Object} indexBuffers object with all the indices streams
* @param {enum} stream_type default gl.STATIC_DRAW (other: gl.DYNAMIC_DRAW, gl.STREAM_DRAW )
*/
Mesh.prototype.addBuffers = function(vertexbuffers, indexbuffers, stream_type)
{
	var num_vertices = 0;

	if(this.vertexBuffers["vertices"])
		num_vertices = this.vertexBuffers["vertices"].data.length / 3;

	for(var i in vertexbuffers)
	{
		var data = vertexbuffers[i];
		if(!data) 
			continue;
		
		if( data.constructor == GL.Buffer )
		{
			data = data.data;
		}
		else if( typeof(data[0]) != "number") //linearize: (transform Arrays in typed arrays)
		{
			var newdata = [];
			for (var j = 0, chunk = 10000; j < data.length; j += chunk) {
			  newdata = Array.prototype.concat.apply(newdata, data.slice(j, j + chunk));
			}
			data = newdata;
		}

		var stream_info = GL.Mesh.common_buffers[i];

		//cast to typed float32 if no type is specified
		if(data.constructor === Array)
		{
			var datatype = GL.Mesh.default_datatype;
			if(stream_info && stream_info.type)
				datatype = stream_info.type;
			data = new datatype( data );
		}

		//compute spacing
		if(i == "vertices")
			num_vertices = data.length / 3;
		var spacing = data.length / num_vertices;
		if(stream_info && stream_info.spacing)
			spacing = stream_info.spacing;

		//add and upload
		var attribute = "a_" + i;
		if(stream_info && stream_info.attribute)
			attribute = stream_info.attribute;
		this.createVertexBuffer( i, attribute, spacing, data, stream_type);
	}

	if(indexbuffers)
		for(var i in indexbuffers)
		{
			var data = indexbuffers[i];
			if(!data) continue;

			if( data.constructor == GL.Buffer )
			{
				data = data.data;
			}
			if( typeof(data[0]) != "number") //linearize
			{
				data = [];
				for (var i = 0, chunk = 10000; i < this.data.length; i += chunk) {
				  data = Array.prototype.concat.apply(data, this.data.slice(i, i + chunk));
				}
			}

			//cast to typed
			if(data.constructor === Array)
			{
				var datatype = Uint16Array;
				if(num_vertices > 256*256)
					datatype = Uint32Array;
				data = new datatype( data );
			}

			this.createIndexBuffer( i, data );
		}
}

/**
* Creates a new empty buffer and attachs it to this mesh
* @method createVertexBuffer
* @param {String} name "vertices","normals"...
* @param {String} attribute name of the stream in the shader "a_vertex","a_normal",... [optional, if omitted is used the common_buffers]
* @param {number} spacing components per vertex [optional, if ommited is used the common_buffers, if not found then uses 3 ]
* @param {ArrayBufferView} buffer_data the data in typed array format [optional, if ommited it created an empty array of getNumVertices() * spacing]
* @param {enum} stream_type [optional, default = gl.STATIC_DRAW (other: gl.DYNAMIC_DRAW, gl.STREAM_DRAW ) ]
*/

Mesh.prototype.createVertexBuffer = function(name, attribute, buffer_spacing, buffer_data, stream_type ) {

	var common = GL.Mesh.common_buffers[name]; //generic info about a buffer with the same name

	if (!attribute && common)
		attribute = common.attribute;

	if (!attribute)
		throw("Buffer added to mesh without attribute name");

	if (!buffer_spacing && common)
	{
		if(common && common.spacing)
			buffer_spacing = common.spacing;
		else
			buffer_spacing = 3;
	}

	if(!buffer_data)
	{
		var num = this.getNumVertices();
		if(!num)
			throw("Cannot create an empty buffer in a mesh without vertices (vertices are needed to know the size)");
		buffer_data = new (GL.Mesh.default_datatype)(num * buffer_spacing);
	}

	if(!buffer_data.buffer)
		throw("Buffer data MUST be typed array");

	//used to ensure the buffers are held in the same gl context as the mesh
	var buffer = this.vertexBuffers[name] = new GL.Buffer(gl.ARRAY_BUFFER, buffer_data, buffer_spacing, stream_type, this.gl );
	buffer.name = name;
	buffer.attribute = attribute;

	return buffer;
}

/**
* Removes a vertex buffer from the mesh
* @method removeVertexBuffer
* @param {String} name "vertices","normals"...
*/
Mesh.prototype.removeVertexBuffer = function(name) {
	var buffer = this.vertexBuffers[name];
	if(!buffer) return;
	delete this.vertexBuffers[name];
}

/**
* Returns a vertex buffer
* @method getVertexBuffer
* @param {String} name of vertex buffer
* @return {Buffer} the buffer
*/
Mesh.prototype.getVertexBuffer = function(name)
{
	return this.vertexBuffers[name];
}


/**
* Creates a new empty index buffer and attachs it to this mesh
* @method createIndexBuffer
* @param {String} name 
* @param {Typed array} data 
* @param {enum} stream_type gl.STATIC_DRAW, gl.DYNAMIC_DRAW, gl.STREAM_DRAW
*/
Mesh.prototype.createIndexBuffer = function(name, buffer_data, stream_type) {
	//(target, data, spacing, stream_type, gl)
	var buffer = this.indexBuffers[name] = new GL.Buffer(gl.ELEMENT_ARRAY_BUFFER, buffer_data, 0, stream_type, this.gl );
	return buffer;
}

/**
* Returns a vertex buffer
* @method getBuffer
* @param {String} name of vertex buffer
* @return {Buffer} the buffer
*/
Mesh.prototype.getBuffer = function(name)
{
	return this.vertexBuffers[name];
}

/**
* Returns a index buffer
* @method getIndexBuffer
* @param {String} name of index buffer
* @return {Buffer} the buffer
*/
Mesh.prototype.getIndexBuffer = function(name)
{
	return this.indexBuffers[name];
}

/**
* Uploads data inside buffers to VRAM.
* @method upload
* @param {number} buffer_type gl.STATIC_DRAW, gl.DYNAMIC_DRAW, gl.STREAM_DRAW
*/
Mesh.prototype.upload = function(buffer_type) {
	for (var attribute in this.vertexBuffers) {
		var buffer = this.vertexBuffers[attribute];
		//buffer.data = this[buffer.name];
		buffer.upload(buffer_type);
	}

	for (var name in this.indexBuffers) {
		var buffer = this.indexBuffers[name];
		//buffer.data = this[name];
		buffer.upload();
	}
}

//LEGACY, plz remove
Mesh.prototype.compile = Mesh.prototype.upload;

/**
* Creates a clone of the mesh, the datarrays are cloned too
* @method clone
*/
Mesh.prototype.clone = function( gl )
{
	var gl = gl || global.gl;
	var vbs = {};
	var ibs = {};

	for(var i in this.vertexBuffers)
	{
		var b = this.vertexBuffers[i];
		vbs[i] = new b.data.constructor( b.data ); //clone
	}
	for(var i in this.indexBuffers)
	{
		var b = this.indexBuffers[i];
		ibs[i] = new b.data.constructor( b.data ); //clone
	}

	return new GL.Mesh( vbs, ibs, undefined, gl );
}

/**
* Creates a clone of the mesh, but the data-arrays are shared between both meshes (useful for sharing a mesh between contexts)
* @method clone
*/
Mesh.prototype.cloneShared = function( gl )
{
	var gl = gl || global.gl;
	return new GL.Mesh( this.vertexBuffers, this.indexBuffers, undefined, gl );
}


/**
* Computes some data about the mesh
* @method generateMetadata
*/
Mesh.prototype.generateMetadata = function()
{
	var metadata = {};

	var vertices = this.vertexBuffers["vertices"].data;
	var triangles = this.indexBuffers["triangles"].data;

	metadata.vertices = vertices.length / 3;
	if(triangles)
		metadata.faces = triangles.length / 3;
	else
		metadata.faces = vertices.length / 9;

	metadata.indexed = !!this.metadata.faces;
	this.metadata = metadata;
}

//Meshes cannot be stored in JSON
Mesh.prototype.toJSON = function()
{
	return "";
}


//never tested
/*
Mesh.prototype.draw = function(shader, mode, range_start, range_length)
{
	if(range_length == 0) return;

	// Create and enable attribute pointers as necessary.
	var length = 0;
	for (var attribute in this.vertexBuffers) {
	  var buffer = this.vertexBuffers[attribute];
	  var location = shader.attributes[attribute] ||
		gl.getAttribLocation(shader.program, attribute);
	  if (location == -1 || !buffer.buffer) continue;
	  shader.attributes[attribute] = location;
	  gl.bindBuffer(gl.ARRAY_BUFFER, buffer.buffer);
	  gl.enableVertexAttribArray(location);
	  gl.vertexAttribPointer(location, buffer.buffer.spacing, gl.FLOAT, false, 0, 0);
	  length = buffer.buffer.length / buffer.buffer.spacing;
	}

	//range rendering
	var offset = 0;
	if(arguments.length > 3) //render a polygon range
		offset = range_start * (this.indexBuffer ? this.indexBuffer.constructor.BYTES_PER_ELEMENT : 1); //in bytes (Uint16 == 2 bytes)

	if(arguments.length > 4)
		length = range_length;
	else if (this.indexBuffer)
		length = this.indexBuffer.buffer.length - offset;

	// Disable unused attribute pointers.
	for (var attribute in shader.attributes) {
	  if (!(attribute in this.vertexBuffers)) {
		gl.disableVertexAttribArray(shader.attributes[attribute]);
	  }
	}

	// Draw the geometry.
	if (length && (!this.indexBuffer || indexBuffer.buffer)) {
	  if (this.indexBuffer) {
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer.buffer);
		gl.drawElements(mode, length, gl.UNSIGNED_SHORT, offset);
	  } else {
		gl.drawArrays(mode, offset, length);
	  }
	}

	return this;
}
*/

/**
* Creates a new index stream with wireframe 
* @method computeWireframe
*/
Mesh.prototype.computeWireframe = function() {
	var index_buffer = this.indexBuffers["triangles"];

	var vertices = this.vertexBuffers["vertices"].data;
	var num_vertices = (vertices.length/3);

	if(!index_buffer) //unindexed
	{
		var num_triangles = num_vertices / 3;
		var buffer = num_vertices > 256*256 ? new Uint32Array( num_triangles * 6 ) : new Uint16Array( num_triangles * 6 );
		for(var i = 0; i < num_vertices; i += 3)
		{
			buffer[i*2] = i;
			buffer[i*2+1] = i+1;
			buffer[i*2+2] = i+1;
			buffer[i*2+3] = i+2;
			buffer[i*2+4] = i+2;
			buffer[i*2+5] = i;
		}

	}
	else //indexed
	{
		var data = index_buffer.data;

		var indexer = new GL.Indexer();
		for (var i = 0; i < data.length; i+=3) {
		  var t = data.subarray(i,i+3);
		  for (var j = 0; j < t.length; j++) {
			var a = t[j], b = t[(j + 1) % t.length];
			indexer.add([Math.min(a, b), Math.max(a, b)]);
		  }
		}

		//linearize
		var unique = indexer.unique;
		var buffer = num_vertices > 256*256 ? new Uint32Array( unique.length * 2 ) : new Uint16Array( unique.length * 2 );
		for(var i = 0, l = unique.length; i < l; ++i)
			buffer.set(unique[i],i*2);
	}

	//create stream
	this.createIndexBuffer('wireframe', buffer);
	return this;
}

/**
* Creates a stream with the normals
* @method computeNormals
* @param {enum} stream_type default gl.STATIC_DRAW (other: gl.DYNAMIC_DRAW, gl.STREAM_DRAW)
*/
Mesh.prototype.computeNormals = function( stream_type  ) {
	var vertices = this.vertexBuffers["vertices"].data;
	var num_vertices = vertices.length / 3;

	//create because it is faster than filling it with zeros (till the .fill method is introduced)
	var normals = new Float32Array( vertices.length );

	var triangles = null;
	if(this.indexBuffers["triangles"])
		triangles = this.indexBuffers["triangles"].data;

	var temp = vec3.create();
	var temp2 = vec3.create();

	var i1,i2,i3,v1,v2,v3,n1,n2,n3;

	//compute the plane normal
	var l = triangles ? triangles.length : vertices.length;
	for (var a = 0; a < l; a+=3)
	{
		if(triangles)
		{
			i1 = triangles[a];
			i2 = triangles[a+1];
			i3 = triangles[a+2];

			v1 = vertices.subarray(i1*3,i1*3+3);
			v2 = vertices.subarray(i2*3,i2*3+3);
			v3 = vertices.subarray(i3*3,i3*3+3);

			n1 = normals.subarray(i1*3,i1*3+3);
			n2 = normals.subarray(i2*3,i2*3+3);
			n3 = normals.subarray(i3*3,i3*3+3);
		}
		else
		{
			v1 = vertices.subarray(a*3,a*3+3);
			v2 = vertices.subarray(a*3+3,a*3+6);
			v3 = vertices.subarray(a*3+6,a*3+9);

			n1 = normals.subarray(a*3,a*3+3);
			n2 = normals.subarray(a*3+3,a*3+6);
			n3 = normals.subarray(a*3+6,a*3+9);
		}

		vec3.sub( temp, v2, v1 );
		vec3.sub( temp2, v3, v1 );
		vec3.cross( temp, temp, temp2 );
		vec3.normalize(temp,temp);

		//save
		vec3.add( n1, n1, temp );
		vec3.add( n2, n2, temp );
		vec3.add( n3, n3, temp );
	}

	//normalize if vertices are shared
	if(triangles)
	for (var a = 0, l = normals.length; a < l; a+=3)
	{
		var n = normals.subarray(a,a+3);
		vec3.normalize(n,n);
	}

	var normals_buffer = this.vertexBuffers["normals"];

	if(normals_buffer)
	{
		normals_buffer.data = normals;
		normals_buffer.upload( stream_type );
	}
	else
		return this.createVertexBuffer('normals', GL.Mesh.common_buffers["normals"].attribute, 3, normals );
	return normals_buffer;
}


/**
* Creates a new stream with the tangents
* @method computeTangents
*/
Mesh.prototype.computeTangents = function() {
	var vertices = this.vertexBuffers["vertices"].data;
	var normals = this.vertexBuffers["normals"].data;
	var uvs = this.vertexBuffers["coords"].data;
	var triangles = this.indexBuffers["triangles"].data;

	if(!vertices || !normals || !uvs) return;

	var num_vertices = vertices.length / 3;

	var tangents = new Float32Array(num_vertices * 4);
	
	//temporary (shared)
	var tan1 = new Float32Array(num_vertices*3*2);
	var tan2 = tan1.subarray(num_vertices*3);

	var a,l;
	var sdir = vec3.create();
	var tdir = vec3.create();
	var temp = vec3.create();
	var temp2 = vec3.create();

	for (a = 0, l = triangles.length; a < l; a+=3)
	{
		var i1 = triangles[a];
		var i2 = triangles[a+1];
		var i3 = triangles[a+2];

		var v1 = vertices.subarray(i1*3,i1*3+3);
		var v2 = vertices.subarray(i2*3,i2*3+3);
		var v3 = vertices.subarray(i3*3,i3*3+3);

		var w1 = uvs.subarray(i1*2,i1*2+2);
		var w2 = uvs.subarray(i2*2,i2*2+2);
		var w3 = uvs.subarray(i3*2,i3*2+2);

		var x1 = v2[0] - v1[0];
		var x2 = v3[0] - v1[0];
		var y1 = v2[1] - v1[1];
		var y2 = v3[1] - v1[1];
		var z1 = v2[2] - v1[2];
		var z2 = v3[2] - v1[2];

		var s1 = w2[0] - w1[0];
		var s2 = w3[0] - w1[0];
		var t1 = w2[1] - w1[1];
		var t2 = w3[1] - w1[1];

		var r;
		var den = (s1 * t2 - s2 * t1);
		if ( Math.abs(den) < 0.000000001 )
		  r = 0.0;
		else
		  r = 1.0 / den;

		vec3.copy(sdir, [(t2 * x1 - t1 * x2) * r, (t2 * y1 - t1 * y2) * r, (t2 * z1 - t1 * z2) * r] );
		vec3.copy(tdir, [(s1 * x2 - s2 * x1) * r, (s1 * y2 - s2 * y1) * r, (s1 * z2 - s2 * z1) * r] );

		vec3.add( tan1.subarray( i1*3, i1*3+3), tan1.subarray( i1*3, i1*3+3), sdir);
		vec3.add( tan1.subarray( i2*3, i2*3+3), tan1.subarray( i2*3, i2*3+3), sdir);
		vec3.add( tan1.subarray( i3*3, i3*3+3), tan1.subarray( i3*3, i3*3+3), sdir);

		vec3.add( tan2.subarray( i1*3, i1*3+3), tan2.subarray( i1*3, i1*3+3), tdir);
		vec3.add( tan2.subarray( i2*3, i2*3+3), tan2.subarray( i2*3, i2*3+3), tdir);
		vec3.add( tan2.subarray( i3*3, i3*3+3), tan2.subarray( i3*3, i3*3+3), tdir);
	}

	for (a = 0, l = vertices.length; a < l; a+=3)
	{
		var n = normals.subarray(a,a+3);
		var t = tan1.subarray(a,a+3);

		// Gram-Schmidt orthogonalize
		vec3.subtract(temp, t, vec3.scale(temp, n, vec3.dot(n, t) ) );
		vec3.normalize(temp,temp);

		// Calculate handedness
		var w = ( vec3.dot( vec3.cross(temp2, n, t), tan2.subarray(a,a+3) ) < 0.0) ? -1.0 : 1.0;
		tangents.set([temp[0], temp[1], temp[2], w],(a/3)*4);
	}

	this.createVertexBuffer('tangents', Mesh.common_buffers["tangents"].attribute, 4, tangents );
}

/**
* Computes bounding information
* @method getVertexNumber
* @param {typed Array} vertices array containing all the vertices
*/
Mesh.prototype.getNumVertices = function() {
	var b = this.vertexBuffers["vertices"];
	if(!b) return 0;
	return b.data.length / b.spacing;
}


/**
* Computes bounding information
* @method Mesh.computeBounding
* @param {typed Array} vertices array containing all the vertices
*/
Mesh.computeBounding = function( vertices, bb ) {

	if(!vertices) return;

	var min = vec3.clone( vertices.subarray(0,3) );
	var max = vec3.clone( vertices.subarray(0,3) );
	var v;
	for(var i = 3; i < vertices.length; i+=3)
	{
		v = vertices.subarray(i,i+3);
		vec3.min( min,v, min);
		vec3.max( max,v, max);
	}

	var center = vec3.add(vec3.create(), min,max );
	vec3.scale( center, center, 0.5);
	var half_size = vec3.subtract( vec3.create(), max, center );

	return BBox.setCenterHalfsize( bb || BBox.create(), center, half_size );
}

/**
* Update bounding information of this mesh
* @method updateBounding
*/
Mesh.prototype.updateBounding = function() {
	var vertices = this.vertexBuffers["vertices"].data;
	if(!vertices) return;
	this.bounding = GL.Mesh.computeBounding(vertices, this.bounding);
}


/**
* forces a bounding box to be set
* @method setBounding
* @param {vec3} center center of the bounding box
* @param {vec3} half_size vector from the center to positive corner
*/
Mesh.prototype.setBounding = function(center, half_size) {
	this.bounding = BBox.setCenterHalfsize( this.bounding || BBox.create(), center, half_size );	
}


/**
* Remove all local memory from the streams (leaving it only in the VRAM) to save RAM
* @method freeData
*/
Mesh.prototype.freeData = function()
{
	for (var attribute in this.vertexBuffers)
	{
		this.vertexBuffers[attribute].data = null;
		delete this[ this.vertexBuffers[attribute].name ]; //delete from the mesh itself
	}
	for (var name in this.indexBuffers)
	{
		this.indexBuffers[name].data = null;
		delete this[ this.indexBuffers[name].name ]; //delete from the mesh itself
	}
}

Mesh.prototype.configure = function(o, options)
{
	var v = {};
	var i = {};
	options = options || {};

	for(var j in o)
	{
		if(!o[j]) continue;

		if(j == "indices" || j == "lines" ||  j == "wireframe" || j == "triangles")
			i[j] = o[j];
		else if(GL.Mesh.common_buffers[j])
			v[j] = o[j];
		else
			options[j] = o[j];
	}

	this.addBuffers(v, i);

	for(var i in options)
		this[i] = options[i];		
}

/**
* Static method for the class Mesh to create a mesh from a list of common streams
* @method Mesh.load
* @param {Object} buffers object will all the buffers
* @param {Object} options
* @param {Mesh} output_mesh optional mesh to store the mesh, otherwise is created
*/
Mesh.load = function(buffers, options, output_mesh) {
	options = options || {};

	var mesh = output_mesh || new GL.Mesh();
	mesh.configure(buffers, options);
	return mesh;
}

/**
* Returns a mesh with all the meshes merged
* @method Mesh.mergeMeshes
* @param {Array} meshes array containing all the meshes
*/
Mesh.mergeMeshes = function(meshes)
{
	var vertex_buffers = {};
	var index_buffers = {};

	var main_mesh = meshes[0];
	var offsets = [];

	//vertex buffers
	for(var i in main_mesh.vertexBuffers)
	{
		var buffer = main_mesh.vertexBuffers[i];

		//compute size
		var total_size = buffer.data.length;
		for(var j = 1; j < meshes.length; ++j)
		{
			if(!meshes[j].vertexBuffers[i])
				throw("cannot merge with different amount of buffers");
			total_size += meshes[j].vertexBuffers[i].data.length;
		}

		//compact
		var data = new Float32Array(total_size);
		var pos = 0;
		for(var j = 0; j < meshes.length; ++j)
		{
			offsets[j] = pos;
			data.set( meshes[j].vertexBuffers[i].data, pos );
			pos += meshes[j].vertexBuffers[i].data.length;
		}

		vertex_buffers[i] = data;
	}

	//index buffers
	for(var i in main_mesh.indexBuffers)
	{
		var buffer = main_mesh.indexBuffers[i];

		//compute size
		var total_size = buffer.data.length;
		for(var j = 1; j < meshes.length; ++j)
		{
			if(!meshes[j].indexBuffers[i])
				throw("cannot merge with different amount of buffers");
			total_size += meshes[j].indexBuffers[i].data.length;
		}

		//remap
		var data = new buffer.constructor(total_size);
		var pos = 0;
		for(var j = 0; j < meshes.length; ++j)
		{
			var b = meshes[j].indexBuffers[i].data;
			if(j == 0)
				data.set( b, pos );
			else
			{
				var offset = offsets[j];
				for(var k = 0, l = b.length; k < l; k++)
					data[k + pos] = b[k] + offset;
			}
			pos += meshes[j].indexBuffers[i].data.length;
		}

		index_buffers[i] = data;
	}

	return new Mesh(vertex_buffers,index_buffers);
}

//Here we store all basic mesh parsers (OBJ, STL)
Mesh.parsers = {};

/**
* Returns am empty mesh and loads a mesh and parses it using the Mesh.parsers, by default only OBJ is supported
* @method Mesh.fromOBJ
* @param {Array} meshes array containing all the meshes
*/
Mesh.fromURL = function(url, on_complete, gl)
{
	gl = gl || global.gl;
	var mesh = new GL.Mesh(undefined,undefined,undefined,gl);
	mesh.ready = false;

	HttpRequest( url, null, function(data) {
		var ext = url.substr(url.length - 4).toLowerCase();
		var parser = GL.Mesh.parsers[ ext ];
		if(parser)
			parser.call(null, data, {mesh: mesh});
		else
			throw("GL.Mesh.fromURL: no parser found for format " + ext);
		delete mesh["ready"];
		if(on_complete)
			on_complete(mesh);
	}, function(err){
		if(on_complete)
			on_complete(null);
	});
	return mesh;
}


Mesh.getScreenQuad = function(gl)
{
	gl = gl || global.gl;
	var mesh = gl.meshes[":screen_quad"];
	if(mesh)
		return mesh;

	var vertices = new Float32Array([0,0,0, 1,1,0, 0,1,0,  0,0,0, 1,0,0, 1,1,0 ]);
	var coords = new Float32Array([0,0, 1,1, 0,1,  0,0, 1,0, 1,1 ]);
	mesh = new GL.Mesh({ vertices: vertices, coords: coords}, undefined, undefined, gl);
	return gl.meshes[":screen_quad"] = mesh;
}
