package com.ilmservice.repository;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.function.Predicate;

import javax.annotation.PreDestroy;
import javax.ejb.Stateless;
import javax.enterprise.context.Dependent;
import javax.enterprise.inject.Default;
import javax.inject.Inject;
import javax.inject.Singleton;

import com.ilmservice.repository.IDbManager.IDbTransaction;
import com.ilmservice.repository.IRepository.Void;


@Default
@Dependent
public class Repository<V> implements IRepository<V> {

	private IDbScope db;
	
	private final Map<Short, IRepositoryIndex<?, V>> indexes;
	private ParseFunction<byte[], V> parserFunction;
	private Function<V, byte[]> serializerFunction;
	private boolean isConfiguringIndexes = false;
	
	private Repository() 
	{
		this.indexes = new HashMap<Short, IRepositoryIndex<?, V>>();
		System.out.println("protobuf repo goin up  ");
	}
	
	@Override 
	public void configure (
		IDbScope db,
		ParseFunction<byte[], V> parser,
		Function<V, byte[]> serializer,
		Void configureIndexes)  
	{
		this.db = db;
		this.parserFunction = parser;
		this.serializerFunction = serializer;
		
		isConfiguringIndexes = true;
		configureIndexes.apply();
		isConfiguringIndexes = false;
		
		// this is where you would run migrations
	}
	
	@Override
	public <K> IRepositoryIndex<K, V> configureIndex(
			short index,
			Function<K, V> defaultSupplier,
			Function<V, K> getKeyFromValue, 
			Function <K, byte[]> getKeyBytesFromKey) throws Exception 
	{
		if(!isConfiguringIndexes) {
			throw new Exception("You must only configure indexes inside the index configuration callback.");
		}
		IRepositoryIndex<K, V> newIndex = new ProtobufIndex<K, V>(
			index,
			parserFunction, 
			defaultSupplier, 
			getKeyFromValue, 
			getKeyBytesFromKey
		);
		indexes.put(index, newIndex);
		return newIndex;
	}
	
	@Override
	public V put(V value) {
		indexes.forEach((k, index) -> {
			db.index(k).put(index.getKeyBytesFromValue(value), serializerFunction.apply(value));
		});
		return value;
	}
	
	@Override
	public void delete (V value) {
		indexes.forEach((k, index) -> {
			db.index(k).delete(index.getKeyBytesFromValue(value));
		});
	}
	
	@PreDestroy
	public void close() {
		System.out.println("protobuf repo goin down");
	}
	
	public class ProtobufIndex<K, V> implements IRepositoryIndex<K, V> {
		public ProtobufIndex (
				short id,
				ParseFunction<byte[], V> parser, 
				Function<K, V> defaultSupplier,
				Function<V, K> getKeyFromValue, 
				Function <K, byte[]> getKeyBytesFromKey) 
		{
			this.id = id;
			this.defaultSupplier = defaultSupplier;
			this.parserFunction = parser;
			this.getKeyFromValueFunction = getKeyFromValue;
			this.getKeyBytesFromKeyFunction = getKeyBytesFromKey;
		}
		
		private final short id;
		private final Function<K, V> defaultSupplier;
		private final ParseFunction<byte[], V> parserFunction;
		private final Function<V, K> getKeyFromValueFunction;
		private final Function <K, byte[]> getKeyBytesFromKeyFunction;
		
		@Override
		public short getId() {
			return id;
		}
		
		@Override
		public V parse(byte[] data) throws IOException {
			return parserFunction.apply(data);
		}
		
		@Override
		public V getDefault(K keyOrNull) {
			return defaultSupplier.apply(keyOrNull);
		}
		
		@Override
		public K getKeyFrom(V value) {
			return getKeyFromValueFunction.apply(value);
		}
		
		@Override
		public byte[] getKeyBytesFromKey(K key) {
			return getKeyBytesFromKeyFunction.apply(key);
		}
		
		@Override
		public byte[] getKeyBytesFromValue(V value) {
			return getKeyBytesFromKeyFunction.apply(getKeyFromValueFunction.apply(value));
		}
		
		@Override
		public IRepositoryQuery<K, V> query() {
			return new ProtobufQuery<K, V>(this);
		}

		@Override
		public K max() {
			// TODO Auto-generated method stub
			return null;
		}
	}
	
	public class ProtobufQuery<K, V> implements IRepositoryQuery<K, V> {

		private ProtobufIndex<K, V> index;
		private boolean descending;
		private K key = null;
		private byte[] fromBytes, toBytes, keyBytes = null;
		private int limit = -1;
		private Predicate<V> predicate = null;
		
		public ProtobufQuery(ProtobufIndex<K, V> index) {
			this.index = index;
		}
		
		@Override
		public IRepositoryQuery<K, V> descending() {
			if(!descending && fromBytes != null) {
				byte[] toTemp = toBytes;
				toBytes = fromBytes;
				fromBytes = toTemp;
			}
			this.descending = true;
			
			return this;
		}

		@Override
		public IRepositoryQuery<K, V> range(K from, K to) {

			byte[] fromBytes = from != null ? index.getKeyBytesFromKey(from) : null;
			byte[] toBytes = to != null ? index.getKeyBytesFromKey(to) : null;
			
			// sort the values if they are both non null
			if(fromBytes != null && toBytes != null) {
				if( (ByteArrayComparator.compare(fromBytes, toBytes) > 0) ^ descending ) {
					byte[] tempToBytes = toBytes;
					toBytes = fromBytes;
					fromBytes = tempToBytes;
				}
			}
			
			this.fromBytes = fromBytes;
			this.toBytes = toBytes;
			return this;
		}

		@Override
		public IRepositoryQuery<K, V> atKey(K key) {
			this.key = key;
			this.keyBytes = index.getKeyBytesFromKey(key);
			return this;
		}
		
		@Override
		public IRepositoryQuery<K, V> limit(int n) {
			this.limit = n;
			return this;
		}

		@Override
		public IRepositoryQuery<K, V> where(Predicate<V> predicate) {
			this.predicate = predicate;
			return this;
		}
		
		@Override
		public V firstOrDefault() {
			return getFirst(index.getDefault(key));
		}
		
		@Override
		public V firstOrNull()  {
			return getFirst(null);
		}
		
		private V getFirst(V defaultValue) {
			if(key != null) {
				try {
					byte[] value = db.index(index.getId()).get(keyBytes);
					return value != null ? index.parse(value) : defaultValue;
				} catch (Exception e) {
					return defaultValue;
				}
			} else {
				limit = 1;
				List<V> zeroOrOne = toArray();
				return zeroOrOne.size() == 1 ? zeroOrOne.get(0) : defaultValue;
			}
		}

		@Override
		public List<V> toArray() {
			return db.index(index.getId()).withIterator(
				fromBytes,
				toBytes,
				descending,
				(iterator) -> {
					List<V> results = new ArrayList<V>();
					while( iterator.hasNext() && (limit == -1 || results.size() < limit) ) {
						V nextElement;
						byte[] nextEntry = iterator.next();
						try {
							nextElement = index.parse(nextEntry);
							if(predicate == null || predicate.test(nextElement)) {
								results.add(nextElement);
							}
						} catch (Exception e) {
							e.printStackTrace();
						}
					}
					return results;
				}
			);
		}


	}


	
}
