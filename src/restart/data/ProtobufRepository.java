package restart.data;

import java.util.HashMap;
import java.util.Map;
import java.util.function.Function;

import javax.inject.Inject;

import restart.data.IProtobufRepository;

public class ProtobufRepository<K, V extends com.google.protobuf.GeneratedMessage> implements IProtobufRepository<K, V> {
	
	@Inject private ILevelDB levelDb;
	
	final Map<String, ProtobufRepositoryIndex> indexes;
	
	private ProtobufRepository() {
		this.indexes = new HashMap<String, ProtobufRepositoryIndex>();
	}
	
	@Override
	public void configureIndex(String name, Function<V, K> getKeyFromValue, Function <K, byte[]> getKeyBytesFromKey) {
		indexes.put(name, new ProtobufRepositoryIndex(getKeyFromValue, getKeyBytesFromKey));
	}
	
	@Override
	public IProtobufQuery<K, V> by(String indexName) {
		return new ProtobufQuery<K, V>();
	}
	
	public class ProtobufQuery<K, V extends com.google.protobuf.GeneratedMessage> implements IProtobufQuery<K, V> {

		@Override
		public IProtobufQuery<K, V> descending() {
			// TODO Auto-generated method stub
			return null;
		}

		@Override
		public IProtobufQuery<K, V> range(K start, K end) {
			// TODO Auto-generated method stub
			return null;
		}

		@Override
		public IProtobufQuery<K, V> atKey(K key) {
			// TODO Auto-generated method stub
			return null;
		}

		@Override
		public IProtobufQuery<K, V> limit(int n) {
			// TODO Auto-generated method stub
			return null;
		}

		@Override
		public V firstOrDefault() {
			// TODO Auto-generated method stub
			return null;
		}

		@Override
		public V[] toArray() {
			// TODO Auto-generated method stub
			return null;
		}
	}
	
	private class ProtobufRepositoryIndex {
		public ProtobufRepositoryIndex (Function<V, K> getKeyFromValue, Function <K, byte[]> getKeyBytesFromKey) {
			this.getKeyFromValue = getKeyFromValue;
			this.getKeyBytesFromKey = getKeyBytesFromKey;
		}
		public final Function<V, K> getKeyFromValue;
		public final Function <K, byte[]> getKeyBytesFromKey;
	}
}
