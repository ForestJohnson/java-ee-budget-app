package restart.data;

import java.io.IOException;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Map.Entry;
import java.util.function.Function;
import java.util.function.Predicate;

import org.iq80.leveldb.DB;
import org.iq80.leveldb.DBIterator;

import com.google.protobuf.Parser;

import restart.data.IProtobufRepository;

public class ProtobufRepository<V extends com.google.protobuf.GeneratedMessage> implements IProtobufRepository<V> {
	
	final Map<String, ProtobufIndex<?, V>> indexes;
	
	private ProtobufRepository() {
		this.indexes = new HashMap<String, ProtobufIndex<?, V>>();
	}
	
	@Override
	public <K> void configureIndex(String name, Parser<V> parser, Function<V, K> getKeyFromValue, Function <K, byte[]> getKeyBytesFromKey) {
		indexes.put(name, new ProtobufIndex<K, V>(parser, getKeyFromValue, getKeyBytesFromKey));
	}
	
	
	@Override
	public void put(DB db, V value) {
		indexes.forEach((k, index) -> {
			db.put(index.getKeyBytesFrom(value), value.toByteArray());
		});
	}
	
	@Override
	public void delete (DB db, V value) {
		indexes.forEach((k, index) -> {
			db.delete(index.getKeyBytesFrom(value));
		});
	}
	
	public class ProtobufIndex<K, V extends com.google.protobuf.GeneratedMessage> implements IProtobufIndex<K, V> {
		public ProtobufIndex (Parser<V> parser, Function<V, K> getKeyFromValue, Function <K, byte[]> getKeyBytesFromKey) {
			this.parser = parser;
			this.getKeyFromValueFunction = getKeyFromValue;
			this.getKeyBytesFromKeyFunction = getKeyBytesFromKey;
		}
		public final Parser<V> parser;
		private final Function<V, K> getKeyFromValueFunction;
		private final Function <K, byte[]> getKeyBytesFromKeyFunction;
		
		public K getKeyFrom(V value) {
			return getKeyFromValueFunction.apply(value);
		}
		
		public byte[] getKeyBytesFrom(K key) {
			return getKeyBytesFromKeyFunction.apply(key);
		}
		
		public byte[] getKeyBytesFrom(V value) {
			return getKeyBytesFromKeyFunction.apply(getKeyFromValueFunction.apply(value));
		}
		
		@Override
		public IProtobufQuery<K, V> query(DB db) {
			return new ProtobufQuery<K, V>(this);
		}
		
	}
	
	public class ProtobufQuery<K, V extends com.google.protobuf.GeneratedMessage> implements IProtobufQuery<K, V> {

		private ProtobufIndex<K, V> index;
		private boolean descending;
		private byte[] from, to = null;
		private int limit = -1;
		private Predicate<V> predicate = null;
		
		public ProtobufQuery(ProtobufIndex<K, V> index) {
			this.index = index;
		}
		
		@Override
		public IProtobufQuery<K, V> descending() {
			if(!descending && from != null) {
				byte[] toTemp = to;
				to = from;
				from = toTemp;
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
				BigInteger fromBigInt = new BigInteger(fromBytes);
				BigInteger toBigInt = new BigInteger(toBytes);
				if( (fromBigInt.compareTo(toBigInt) > 0) ^ descending) {
					byte[] tempToBytes = toBytes;
					toBytes = fromBytes;
					fromBytes = tempToBytes;
				}
			}
			
			this.from = fromBytes;
			this.to = toBytes;
			return this;
		}

		@Override
		public IProtobufQuery<K, V> atKey(K key) {
			this.from = index.getKeyBytesFrom(key);
			this.to = index.getKeyBytesFrom(key);
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
		public V firstOrDefault() throws IOException {
			limit = 1;
			List<V> zeroOrOne = iterate();
			return zeroOrOne.size() == 1 ? zeroOrOne.get(0) : null;
		}

		@Override
		public List<V> toArray() throws IOException {
			return iterate();
		}
		
		private List<V> iterate() throws IOException {
			
			DB db = null;
			List<V> results = new ArrayList<V>();
			
			try(DBIterator iterator = db.iterator()) {
				if(from != null) {
					iterator.seek(from);
				} else if(descending) {
					iterator.seekToLast();
				} else {
					iterator.seekToFirst();
				}
				
				while((descending ? iterator.hasPrev() : iterator.hasNext()) && limit == -1 || results.size() < limit) {
					Entry<byte[], byte[]> nextEntry = descending ? iterator.prev() : iterator.next();
					V nextElement = index.parser.parseFrom(nextEntry.getValue());
					if(predicate == null || predicate.test(nextElement)) {
						results.add(nextElement);
					}
				}
			}
			
			return results;
		}

	}


	
}
