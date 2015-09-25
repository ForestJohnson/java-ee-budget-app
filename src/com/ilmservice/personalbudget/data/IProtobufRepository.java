package com.ilmservice.personalbudget.data;

import java.io.IOException;
import java.util.List;
import java.util.function.Function;
import java.util.function.Predicate;

import org.iq80.leveldb.DBException;

import com.ilmservice.personalbudget.protobufs.Events.Event;

public interface IProtobufRepository<V extends com.google.protobuf.Message> {
	/**
	 * @param parser a function that returns an instance of <V> given a byte array.
	 * <pre>
	 * tests.configure( 
	 * 	(x) -> Event.parseFrom(x)
	 * );
	 * </pre>
	 */
	public void configure(
		ParseFunction<byte[], V> parser
	);
	
	/**
	 * creates an index for this repository with the key type of your choice.
	 * 
	 * @param name 
	 * @param defaultSupplier a function that returns the default instance of <V>. 
	 * 		  if a <K> key is provided, the function should set the key value on the <V>.
	 * @param getKeyFromValue a function that returns the <K> key given the <V> value.
	 * @param getKeyBytesFromKey a function that translates a <K> key to a byte array for storage.
	 * 
	 * <pre>
	 * transactionRepository.configureIndex(
	 * 	"id",
	 * 	(k) -> Transaction.newBuilder().setTransactionId(k).build(),
	 * 	(v) -> v.getTransactionId(),
	 * 	(k) -> ByteBuffer.allocate(4).putInt(k).array()
	 * );
	 * </pre>
	 */
	public <K> IProtobufIndex<K, V> configureIndex(
		String name,
		Function<K, V> defaultSupplier,
		Function<V, K> getKeyFromValue, 
		Function <K, byte[]> getKeyBytesFromKey
	);
	public V put(V value);
	public void delete(V value);

	
	public interface IProtobufIndex<K, V extends com.google.protobuf.Message> {
		public IProtobufQuery<K, V> query();
		public V getDefault(K keyOrNull);
		public V parse(byte[] data) throws IOException;
		public K getKeyFrom(V value);
		public byte[] getKeyBytesFrom(K key);
		public byte[] getKeyBytesFrom(V value);
	}
	
	public interface IProtobufQuery<K, V extends com.google.protobuf.Message> {
		public IProtobufQuery<K, V> descending();
		public IProtobufQuery<K, V> range(K start, K end);
		public IProtobufQuery<K, V> atKey (K key);
		public IProtobufQuery<K, V> where (Predicate<V> predicate);
		public IProtobufQuery<K, V> limit(int n);
		public V firstOrDefault() throws IOException  , DBException;
		public V firstOrNull() throws IOException  , DBException;
		public List<V> toArray();
	}
}
