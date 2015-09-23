package restart.data;

import java.util.Map;
import java.util.function.Function;

public interface IProtobufRepository<K, V extends com.google.protobuf.GeneratedMessage> {
	public void configureIndex(String name, Function<V, K> getKeyFromValue, Function <K, byte[]> getKeyBytesFromKey);
	public IProtobufQuery<K, V> by(String indexName);
	
	public interface IProtobufQuery<K, V extends com.google.protobuf.GeneratedMessage> {
		
		public IProtobufQuery<K, V> descending();
		
		public IProtobufQuery<K, V> range(K start, K end);
		
		public IProtobufQuery<K, V> atKey (K key);
		
		public IProtobufQuery<K, V> limit(int n);
		
		public V firstOrDefault();
		
		public V[] toArray();
	}
}
