package restart.data;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Map.Entry;
import java.util.function.Function;
import java.util.function.Predicate;

import javax.annotation.PreDestroy;
import javax.ejb.Stateless;
import javax.enterprise.inject.Default;
import javax.inject.Inject;

import org.iq80.leveldb.DBIterator;

@Default
@Stateless
public class ProtobufRepository<V extends com.google.protobuf.GeneratedMessage> implements IProtobufRepository<V> {

	@Inject private ILevelDBManager levelDb;
	
	private final Map<String, IProtobufIndex<?, V>> indexes;
	private Function<byte[], V> parserFunction;
	
	private ProtobufRepository() 
	{
		this.indexes = new HashMap<String, IProtobufIndex<?, V>>();
		System.out.println("protobuf repo goin up");
	}
	
	@Override 
	public void configure (
		Function<byte[], V> parser)  
	{
		this.parserFunction = parser;
	}
	
	@Override
	public <K> IProtobufIndex<K, V> configureIndex(
			String name,
			Function<K, V> defaultSupplier,
			Function<V, K> getKeyFromValue, 
			Function <K, byte[]> getKeyBytesFromKey) 
	{
		IProtobufIndex<K, V> newIndex = new ProtobufIndex<K, V>(
			parserFunction, 
			defaultSupplier, 
			getKeyFromValue, 
			getKeyBytesFromKey
		);
		indexes.put(name, newIndex);
		return newIndex;
	}
	
	@Override
	public V put(V value) {
		indexes.forEach((k, index) -> {
			levelDb.get().put(index.getKeyBytesFrom(value), value.toByteArray());
		});
		return value;
	}
	
	@Override
	public void delete (V value) {
		indexes.forEach((k, index) -> {
			levelDb.get().delete(index.getKeyBytesFrom(value));
		});
	}
	
	@PreDestroy
	public void close() {
		System.out.println("protobuf repo goin down");
	}
	
	public class ProtobufIndex<K, V extends com.google.protobuf.GeneratedMessage> implements IProtobufIndex<K, V> {
		public ProtobufIndex (
				Function<byte[], V> parser, 
				Function<K, V> defaultSupplier,
				Function<V, K> getKeyFromValue, 
				Function <K, byte[]> getKeyBytesFromKey) 
		{
			this.defaultSupplier = defaultSupplier;
			this.parserFunction = parser;
			this.getKeyFromValueFunction = getKeyFromValue;
			this.getKeyBytesFromKeyFunction = getKeyBytesFromKey;
		}

		private final Function<K, V> defaultSupplier;
		private final Function<byte[], V> parserFunction;
		private final Function<V, K> getKeyFromValueFunction;
		private final Function <K, byte[]> getKeyBytesFromKeyFunction;
		
		@Override
		public V parse(byte[] data) {
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
		public byte[] getKeyBytesFrom(K key) {
			return getKeyBytesFromKeyFunction.apply(key);
		}
		
		@Override
		public byte[] getKeyBytesFrom(V value) {
			return getKeyBytesFromKeyFunction.apply(getKeyFromValueFunction.apply(value));
		}
		
		@Override
		public IProtobufQuery<K, V> query() {
			return new ProtobufQuery<K, V>(this);
		}
	}
	
	public class ProtobufQuery<K, V extends com.google.protobuf.GeneratedMessage> implements IProtobufQuery<K, V> {

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
		public IProtobufQuery<K, V> descending() {
			if(!descending && fromBytes != null) {
				byte[] toTemp = toBytes;
				toBytes = fromBytes;
				fromBytes = toTemp;
			}
			this.descending = true;
			
			return this;
		}

		@Override
		public IProtobufQuery<K, V> range(K from, K to) {

			byte[] fromBytes = from != null ? index.getKeyBytesFrom(from) : null;
			byte[] toBytes = to != null ? index.getKeyBytesFrom(to) : null;
			
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
		public IProtobufQuery<K, V> atKey(K key) {
			this.key = key;
			this.keyBytes = index.getKeyBytesFrom(key);
			return this;
		}
		
		@Override
		public IProtobufQuery<K, V> limit(int n) {
			this.limit = n;
			return this;
		}

		@Override
		public IProtobufQuery<K, V> where(Predicate<V> predicate) {
			this.predicate = predicate;
			return this;
		}
		
		@Override
		public V firstOrDefault() {
			return getFirst(index.getDefault(key));
		}
		
		@Override
		public V firstOrNull() {
			return getFirst(null);
		}
		
		private V getFirst(V defaultValue) {
			if(key != null) {
				byte[] value = levelDb.get().get(keyBytes);
				return value != null ? index.parse(value) : defaultValue;
			} else {
				limit = 1;
				List<V> zeroOrOne = toArray();
				return zeroOrOne.size() == 1 ? zeroOrOne.get(0) : defaultValue;
			}
		}

		@Override
		public List<V> toArray() {
			List<V> results = new ArrayList<V>();
			
			try(DBIterator iterator = levelDb.get().iterator()) {
				if(fromBytes != null) {
					iterator.seek(fromBytes);
				} else if(descending) {
					iterator.seekToLast();
				} else {
					iterator.seekToFirst();
				}
				Entry<byte[], byte[]> nextEntry = null;
				while(
						(descending ? iterator.hasPrev() : iterator.hasNext()) 
					&&  (limit == -1 || results.size() < limit)
					&&  ((ByteArrayComparator.compare(
							toBytes, 
							(nextEntry = (descending ? iterator.prev() : iterator.next())).getKey()
						 ) > 0) ^ descending )
					) 
				{
					V nextElement = index.parse(nextEntry.getValue());
					if(predicate == null || predicate.test(nextElement)) {
						results.add(nextElement);
					}
				}
			} catch(IOException ex) {
				ex.printStackTrace();
			}
			
			return results;
		}


	}


	
}
