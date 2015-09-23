package restart.data;

import java.io.IOException;
import java.util.List;
import java.util.function.Function;
import java.util.function.Predicate;

import org.iq80.leveldb.DB;

import com.google.protobuf.Parser;

public interface IProtobufRepository<V extends com.google.protobuf.GeneratedMessage> {
	public <K> void configureIndex(String name, Parser<V> parser, Function<V, K> getKeyFromValue, Function <K, byte[]> getKeyBytesFromKey);
	public void put(DB db, V value);
	public void delete(DB db, V value);
	
	public interface IProtobufIndex<K, V extends com.google.protobuf.GeneratedMessage> {
		public IProtobufQuery<K, V> query(DB db);
	}
	
	public interface IProtobufQuery<K, V extends com.google.protobuf.GeneratedMessage> {
		
		public IProtobufQuery<K, V> descending();
		
		public IProtobufQuery<K, V> range(K start, K end);
		
		public IProtobufQuery<K, V> atKey (K key);
		
		public IProtobufQuery<K, V> where (Predicate<V> predicate);
		
		public IProtobufQuery<K, V> limit(int n);
		
		public V firstOrDefault() throws IOException ;
		
		public List<V> toArray() throws IOException ;
	}
}
